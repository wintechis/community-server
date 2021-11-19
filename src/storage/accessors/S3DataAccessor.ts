import type { Readable } from 'stream';
import { RepresentationMetadata } from '../../http/representation/RepresentationMetadata';
import type { ResourceIdentifier } from '../../http/representation/ResourceIdentifier';
import { getLoggerFor } from '../../logging/LogUtil';
import { NotFoundHttpError } from '../../util/errors/NotFoundHttpError';
import type { Guarded } from '../../util/GuardedStream';
import { ensureTrailingSlash } from '../../util/PathUtil';
import type { DataAccessor } from './DataAccessor';

/**
 * DataAccessor that uses an Amazon S3 Bucket.
 */
export class S3DataAccessor implements DataAccessor {
  private readonly baseUrl: string;
  private readonly bucketName: string;
  protected readonly logger = getLoggerFor(this);

  public constructor(baseUrl: string, bucketName: string) {
    this.baseUrl = ensureTrailingSlash(baseUrl);
    this.bucketName = bucketName;
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
    this.logger.debug(objectId);
    throw new NotFoundHttpError();
  }

  /**
   * Will return corresponding metadata by reading the metadata file (if it exists)
   * and adding file system specific metadata elements.
   */
  public async getMetadata(identifier: ResourceIdentifier): Promise<RepresentationMetadata> {
    this.logger.debug(identifier.path);
    throw new NotFoundHttpError();
  }

  public async* getChildren(identifier: ResourceIdentifier): AsyncIterableIterator<RepresentationMetadata> {
    yield new RepresentationMetadata({ path: identifier.path });
  }

  /**
   * Writes the given data as a file (and potential metadata as additional file).
   * The metadata file will be written first and will be deleted if something goes wrong writing the actual data.
   */
  public async writeDocument(identifier: ResourceIdentifier, data: Guarded<Readable>, metadata: RepresentationMetadata):
  Promise<void> {
    this.logger.debug(identifier.path);
    this.logger.debug(data.readable.toString());
    this.logger.debug(metadata.contentType!.toString());
  }

  /**
   * Creates corresponding folder if necessary and writes metadata to metadata file if necessary.
   */
  public async writeContainer(identifier: ResourceIdentifier, metadata: RepresentationMetadata): Promise<void> {
    this.logger.debug(identifier.path);
    this.logger.debug(metadata.contentType!.toString());
  }

  /**
   * Removes the corresponding file/folder (and metadata file).
   */
  public async deleteResource(identifier: ResourceIdentifier): Promise<void> {
    this.logger.debug(identifier.path);
    throw new NotFoundHttpError();
  }
}
