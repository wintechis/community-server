import { namedNode } from '@rdfjs/data-model';
import type { Quad, NamedNode } from '@rdfjs/types';
import { BasicRepresentation } from '../http/representation/BasicRepresentation';
import type { Representation } from '../http/representation/Representation';
import type { RepresentationMetadata } from '../http/representation/RepresentationMetadata';
import type { RepresentationPreferences } from '../http/representation/RepresentationPreferences';
import type { ResourceIdentifier } from '../http/representation/ResourceIdentifier';
import { getLoggerFor } from '../logging/LogUtil';
import { INTERNAL_QUADS } from '../util/ContentTypes';
import { LDP, RDF, VANN } from '../util/Vocabularies';
import type { Conditions } from './Conditions';
import { PassthroughStore } from './PassthroughStore';
import type { ResourceStore } from './ResourceStore';

export class DirectContainerStore<T extends ResourceStore = ResourceStore> extends PassthroughStore<T> {
  protected readonly logger = getLoggerFor(this);

  public async getRepresentation(identifier: ResourceIdentifier, preferences: RepresentationPreferences,
    conditions?: Conditions): Promise<Representation> {
    const representation = await this.source.getRepresentation(identifier, preferences, conditions);
    const direct = representation.metadata.quads(
      representation.metadata.identifier,
      RDF.type,
      LDP.DirectContainer,
    ).length > 0;

    if (representation.metadata.contentType === INTERNAL_QUADS) {
      if (direct) {
        this.removeBasicContainerInRepresentation(representation);
        this.addMembershipTriples(representation);
      }
      await Promise.all(representation.metadata.quads(
        null,
        namedNode(RDF.type),
        namedNode(LDP.BasicContainer),
      ).filter(
        (qu: Quad): boolean => !qu.subject.equals(representation.metadata.identifier),
      ).map(
        (qu: Quad): ResourceIdentifier => ({ path: qu.subject.value }),
      ).map(
        async(container: ResourceIdentifier): Promise<void> => await this.removeBasicContainerInMetadata(
          container,
          representation.metadata,
        ),
      ));

      return new BasicRepresentation(
        representation.metadata.quads().filter((qu: Quad): boolean =>
          !qu.predicate.equals(namedNode(VANN.preferredNamespacePrefix)) &&
          !qu.predicate.equals(namedNode('http://www.w3.org/ns/ma-ont#format'))),
        representation.metadata,
        representation.binary,
      );
    }
    return representation;
  }

  private addMembershipTriples(representation: Representation): void {
    const memResource = representation.metadata.quads(
      representation.metadata.identifier,
      LDP.membershipResource,
      null,
    )[0]?.object as NamedNode;
    if (memResource === undefined) {
      return;
    }
    const hasMemRelation = representation.metadata.quads(
      representation.metadata.identifier,
      LDP.hasMemberRelation,
      null,
    )[0]?.object as NamedNode;
    const isMemOfRelation = representation.metadata.quads(
      representation.metadata.identifier,
      LDP.isMemberOfRelation,
      null,
    )[0]?.object as NamedNode;
    const children = representation.metadata.quads(
      representation.metadata.identifier,
      LDP.contains,
      null,
    ).map(
      (qu: Quad): NamedNode => qu.object as NamedNode,
    );
    if (hasMemRelation !== undefined) {
      children.forEach((child: NamedNode): void => {
        representation.metadata.addQuad(memResource, hasMemRelation, child);
      });
    } else {
      children.forEach((child: NamedNode): void => {
        representation.metadata.addQuad(child, isMemOfRelation, memResource);
      });
    }
  }

  private removeBasicContainerInRepresentation(representation: Representation): void {
    representation.metadata.remove(namedNode(RDF.type), namedNode(LDP.BasicContainer));
  }

  private async removeBasicContainerInMetadata(container: ResourceIdentifier,
    metadata: RepresentationMetadata): Promise<void> {
    const representation = await this.source.getRepresentation(container, {});
    const direct = representation.metadata.quads(
      representation.metadata.identifier,
      RDF.type,
      LDP.DirectContainer,
    ).length > 0;
    if (direct) {
      this.logger.info(`Direct: ${container.path}`);
      metadata.removeQuad(namedNode(container.path), namedNode(RDF.type), namedNode(LDP.BasicContainer));
      metadata.addQuad(namedNode(container.path), namedNode(RDF.type), namedNode(LDP.DirectContainer));
    }
  }
}
