import type { Readable } from 'stream';
import { DeleteObjectsCommand, NoSuchKey, ObjectIdentifier, _Object } from '@aws-sdk/client-s3';
import { ListObjectsCommand, DeleteObjectCommand, GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import type { Quad } from 'rdf-js';
import { RepresentationMetadata } from '../../http/representation/RepresentationMetadata';
import type { ResourceIdentifier } from '../../http/representation/ResourceIdentifier';
import { getLoggerFor } from '../../logging/LogUtil';
import { NotFoundHttpError } from '../../util/errors/NotFoundHttpError';
import type { Guarded } from '../../util/GuardedStream';
import { guardStream } from '../../util/GuardedStream';
import { ensureTrailingSlash } from '../../util/PathUtil';
import { parseQuads, serializeQuads } from '../../util/QuadUtil';
import { addResourceMetadata } from '../../util/ResourceUtil';
import { CONTENT_TYPE, DC, LDP, RDF } from '../../util/Vocabularies';
import type { DataAccessor } from './DataAccessor';

/**
 * DataAccessor that uses an Amazon S3 Bucket.
 */
export class S3DataAccessor implements DataAccessor {
  private readonly baseUrl: string;
  private readonly bucketName: string;
  private readonly s3client: S3Client;
  protected readonly logger = getLoggerFor(this);

  public constructor(baseUrl: string, bucketName: string) {
    this.baseUrl = ensureTrailingSlash(baseUrl);
    this.bucketName = bucketName;
    this.s3client = new S3Client({});
  }

  /**
   * All representations can be handled
   */
  public async canHandle(): Promise<void> {
    // All can be handled
  }

  /**
   * Will return data stream directly to the file corresponding to the resource.
   * Will throw NotFoundHttpError if the input is a container.
   */
  public async getData(identifier: ResourceIdentifier): Promise<Guarded<Readable>> {
    const objectId = identifier.path.replace(this.baseUrl, '');
    try {
      const object = await this.s3client.send(new GetObjectCommand({
        // eslint-disable-next-line @typescript-eslint/naming-convention
        Bucket: this.bucketName,
        // eslint-disable-next-line @typescript-eslint/naming-convention
        Key: objectId,
      }));
      this.logger.info(`Got Data: ${identifier.path}`);
      return guardStream(object.Body as Readable);
    } catch (error: unknown) {
      if ((error as NoSuchKey).name === 'NoSuchKey') {
        this.logger.info(`Got no data (not found): ${identifier.path}`);
        throw new NotFoundHttpError();
      }
      this.logger.info(`Got no data (${error}): ${identifier.path}`);
      throw error;
    }
  }

  /**
   * Will return corresponding metadata by reading the metadata object (if it exists).
   */
  public async getMetadata(identifier: ResourceIdentifier): Promise<RepresentationMetadata> {
    const objectId = identifier.path.replace(this.baseUrl, '');
    // Root container
    if (objectId.length === 0) {
      this.logger.info(`Got metadata: ${identifier.path}`);
      const metadata = new RepresentationMetadata(identifier).addQuads(await this.getRawMetadata(identifier));
      addResourceMetadata(metadata, true);
      return metadata;
    }

    try {
      // Check if objects exists
      await this.s3client.send(new GetObjectCommand({
        // eslint-disable-next-line @typescript-eslint/naming-convention
        Bucket: this.bucketName,
        // eslint-disable-next-line @typescript-eslint/naming-convention
        Key: objectId,
      }));
      this.logger.info(`Got metadata: ${identifier.path}`);
      const metadata = new RepresentationMetadata(identifier).addQuads(await this.getRawMetadata(identifier));
      // Is container?
      if (objectId.endsWith('/')) {
        addResourceMetadata(metadata, true);
        return metadata;
      }
      addResourceMetadata(metadata, false);
      return metadata.set(CONTENT_TYPE, 'text/turtle');
    } catch (error: unknown) {
      this.logger.info(`Got no metadata: ${identifier.path}`);
      if ((error as NoSuchKey).name === 'NoSuchKey') {
        throw new NotFoundHttpError();
      } else {
        throw error;
      }
    }
  }

  public async* getChildren(identifier: ResourceIdentifier): AsyncIterableIterator<RepresentationMetadata> {
    this.logger.info(`Get children: ${identifier.path}`);
    const objectId = identifier.path.replace(this.baseUrl, '');
    const listing = await this.s3client.send(new ListObjectsCommand({
      // eslint-disable-next-line @typescript-eslint/naming-convention
      Bucket: this.bucketName,
      // eslint-disable-next-line @typescript-eslint/naming-convention
      Prefix: objectId,
      // eslint-disable-next-line @typescript-eslint/naming-convention
      Delimiter: '/',
    }));

    for (const container of listing.CommonPrefixes ?? []) {
      const metadata = new RepresentationMetadata({
        path: `${this.baseUrl}${container.Prefix}`,
      });
      addResourceMetadata(metadata, true);
      yield metadata;
    }

    for (const resource of listing.Contents ?? []) {
      // Skip entry for self
      if (resource.Key === objectId) {
        continue;
      }
      const metadata = new RepresentationMetadata({
        path: `${this.baseUrl}${resource.Key}`,
      });
      addResourceMetadata(metadata, false);
      yield metadata;
    }
  }

  /**
   * Writes the given data as a file (and potential metadata as additional file).
   * The metadata file will be written first and will be deleted if something goes wrong writing the actual data.
   */
  public async writeDocument(identifier: ResourceIdentifier, data: Guarded<Readable>, metadata: RepresentationMetadata):
  Promise<void> {
    this.logger.info(`Write Document: ${identifier.path}`);
    const objectId = identifier.path.replace(this.baseUrl, '');
    const metaId = `${objectId}.meta`;
    const wroteMetadata = await this.writeMetadata(metaId, metadata);
    try {
      const upload = new Upload({
        client: this.s3client,
        params: {
          // eslint-disable-next-line @typescript-eslint/naming-convention
          Bucket: this.bucketName,
          // eslint-disable-next-line @typescript-eslint/naming-convention
          Key: objectId,
          // eslint-disable-next-line @typescript-eslint/naming-convention
          Body: data as Readable,
        },
      });
      await upload.done();
    } catch (error: unknown) {
      this.logger.error(`writeDocument: ${error as string}`);
      // Delete the metadata if there was an error writing the file
      if (wroteMetadata) {
        await this.s3client.send(new DeleteObjectCommand({
          // eslint-disable-next-line @typescript-eslint/naming-convention
          Bucket: this.bucketName,
          // eslint-disable-next-line @typescript-eslint/naming-convention
          Key: metaId,
        }));
      }
      throw error;
    }
  }

  /**
   * Creates corresponding folder if necessary and writes metadata to metadata file if necessary.
   */
  public async writeContainer(identifier: ResourceIdentifier, metadata: RepresentationMetadata): Promise<void> {
    this.logger.info(`Write container: ${identifier.path}`);
    const objectId = identifier.path.replace(this.baseUrl, '');
    const metaId = `${objectId}.meta`;
    if (objectId.length > 0) {
      try {
        const upload = new Upload({
          client: this.s3client,
          params: {
            // eslint-disable-next-line @typescript-eslint/naming-convention
            Bucket: this.bucketName,
            // eslint-disable-next-line @typescript-eslint/naming-convention
            Key: objectId,
            // eslint-disable-next-line @typescript-eslint/naming-convention
            Body: '',
          },
        });
        await upload.done();
      } catch (error: unknown) {
        this.logger.error(`writeContainer: ${error as string}`);
      }
    }
    await this.writeMetadata(metaId, metadata);
  }

  /**
   * Removes the corresponding object, metadata object and all objects in this "folder".
   */
  public async deleteResource(identifier: ResourceIdentifier): Promise<void> {
    this.logger.info(`Delete resource: ${identifier.path}`);
    const objectId = identifier.path.replace(this.baseUrl, '');
    const metaId = `${objectId}.meta`;

    try {
      await this.s3client.send(new DeleteObjectCommand({
        // eslint-disable-next-line @typescript-eslint/naming-convention
        Bucket: this.bucketName,
        // eslint-disable-next-line @typescript-eslint/naming-convention
        Key: objectId,
      }));
    } catch (error: unknown) {
      if ((error as NoSuchKey).name !== 'NoSuchKey') {
        throw error;
      }
    }

    try {
      await this.s3client.send(new DeleteObjectCommand({
        // eslint-disable-next-line @typescript-eslint/naming-convention
        Bucket: this.bucketName,
        // eslint-disable-next-line @typescript-eslint/naming-convention
        Key: metaId,
      }));
    } catch (error: unknown) {
      if ((error as NoSuchKey).name !== 'NoSuchKey') {
        throw error;
      }
    }
  }

  /**
   * Reads the metadata from the corresponding metadata object.
   * Returns an empty array if there is no metadata object.
   *
   * @param identifier - Identifier of the resource (not the metadata!).
   */
  private async getRawMetadata(identifier: ResourceIdentifier): Promise<Quad[]> {
    const objectId = identifier.path.replace(this.baseUrl, '');
    try {
      const metaObject = await this.s3client.send(new GetObjectCommand({
        // eslint-disable-next-line @typescript-eslint/naming-convention
        Bucket: this.bucketName,
        // eslint-disable-next-line @typescript-eslint/naming-convention
        Key: `${objectId}.meta`,
      }));
      const readMetadataStream = guardStream(metaObject.Body as Readable);
      return await parseQuads(readMetadataStream, { format: metaObject.ContentType, baseIRI: identifier.path });
    } catch (error: unknown) {
      if ((error as NoSuchKey).name === 'NoSuchKey') {
        return [];
      }
      throw error;
    }
  }

  /**
   * Writes the metadata of the resource to a meta object.
   * @param metaId - Object Id of the meta object.
   * @param metadata - Metadata to write.
   *
   * @returns True if data was written to a file.
   */
  private async writeMetadata(metaId: string, metadata: RepresentationMetadata): Promise<boolean> {
    // These are stored by file system conventions
    metadata.remove(RDF.terms.type, LDP.terms.Resource);
    metadata.remove(RDF.terms.type, LDP.terms.Container);
    metadata.remove(RDF.terms.type, LDP.terms.BasicContainer);
    metadata.removeAll(DC.terms.modified);
    metadata.removeAll(CONTENT_TYPE);
    const quads = metadata.quads();
    let wroteMetadata: boolean;

    // Write metadata to object if there are quads remaining
    if (quads.length > 0) {
      // Determine required content-type based on mapper
      const serializedMetadata = serializeQuads(quads, 'text/turtle');
      try {
        const upload = new Upload({
          client: this.s3client,
          params: {
            // eslint-disable-next-line @typescript-eslint/naming-convention
            Bucket: this.bucketName,
            // eslint-disable-next-line @typescript-eslint/naming-convention
            Key: metaId,
            // eslint-disable-next-line @typescript-eslint/naming-convention
            Body: serializedMetadata as Readable,
          },
        });
        await upload.done();
      } catch (error: unknown) {
        this.logger.error(`writeMetadata: ${error as string}`);
      }

      wroteMetadata = true;
    // Delete (potentially) existing metadata file if no metadata needs to be stored
    } else {
      try {
        await this.s3client.send(new DeleteObjectCommand({
          // eslint-disable-next-line @typescript-eslint/naming-convention
          Bucket: this.bucketName,
          // eslint-disable-next-line @typescript-eslint/naming-convention
          Key: metaId,
        }));
      } catch (error: unknown) {
        // Metadata file doesn't exist so nothing needs to be removed
        if ((error as NoSuchKey).name !== 'NoSuchKey') {
          throw error;
        }
      }
      wroteMetadata = false;
    }
    return wroteMetadata;
  }
}
