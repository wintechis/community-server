import { namedNode } from '@rdfjs/data-model';
import type { Quad, NamedNode } from '@rdfjs/types';
import { BasicRepresentation } from '../http/representation/BasicRepresentation';
import type { Representation } from '../http/representation/Representation';
import type { RepresentationMetadata } from '../http/representation/RepresentationMetadata';
import type { RepresentationPreferences } from '../http/representation/RepresentationPreferences';
import type { ResourceIdentifier } from '../http/representation/ResourceIdentifier';
import { INTERNAL_QUADS } from '../util/ContentTypes';
import { LDP, RDF, VANN } from '../util/Vocabularies';
import type { Conditions } from './Conditions';
import { PassthroughStore } from './PassthroughStore';
import type { ResourceStore } from './ResourceStore';

/**
 * A PassthroughStore that adds the functionality of ldp:DirectContainer. It does so by getting
 * representations from its undelying store and checking whether a rdf:type ldp:DirectContainer triple
 * is present. If so, the rdf:type ldp:BasicContainer triple is removed and membership triples are added.
 * BE CAREFUL: This is a very hacky solution and probably should be done properly!
 */
export class DirectContainerStore<T extends ResourceStore = ResourceStore> extends PassthroughStore<T> {
  public async getRepresentation(identifier: ResourceIdentifier, preferences: RepresentationPreferences,
    conditions?: Conditions): Promise<Representation> {
    // Get the representation from the underlying store
    const representation = await this.source.getRepresentation(identifier, preferences, conditions);

    // Is a rdf:type ldp:DirectContainer triple present?
    const direct = representation.metadata.quads(
      representation.metadata.identifier,
      RDF.type,
      LDP.DirectContainer,
    ).length > 0;

    // If the representation is that of a container, the content type will be internal/quads
    if (representation.metadata.contentType === INTERNAL_QUADS) {
      if (direct) {
        this.removeBasicContainerInRepresentation(representation);
        this.addMembershipTriples(representation);
      }

      // Also remove the ldp:BasicContainer type for resources for which metadata is
      // displayed (usually contained resource)
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
        // The metadata is serialized as data
        representation.metadata.quads().filter((qu: Quad): boolean =>
          // Remove some triples that are in the metadata but not in the serialization (very hacky!)
          !qu.predicate.equals(namedNode(VANN.preferredNamespacePrefix)) &&
          !qu.predicate.equals(namedNode('http://www.w3.org/ns/ma-ont#format'))),
        representation.metadata,
        representation.binary,
      );
    }
    return representation;
  }

  // Responsible for adding the LDP membership triples
  private addMembershipTriples(representation: Representation): void {
    // Getting the different triples from the container triples
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

    // Adding membership triples (two cases depending on the position of the fixed resource)
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

  // Remove the rdf:type ldp:BasicContainer triple from the metadata of the representation
  private removeBasicContainerInRepresentation(representation: Representation): void {
    representation.metadata.remove(namedNode(RDF.type), namedNode(LDP.BasicContainer));
  }

  // Remove the rdf:type ldp:BasicContainer triple for some IRI from other metadata and add
  // rdf:type ldp:DirectContainer
  private async removeBasicContainerInMetadata(container: ResourceIdentifier,
    metadata: RepresentationMetadata): Promise<void> {
    const representation = await this.source.getRepresentation(container, {});
    const direct = representation.metadata.quads(
      representation.metadata.identifier,
      RDF.type,
      LDP.DirectContainer,
    ).length > 0;
    if (direct) {
      metadata.removeQuad(namedNode(container.path), namedNode(RDF.type), namedNode(LDP.BasicContainer));
      metadata.addQuad(namedNode(container.path), namedNode(RDF.type), namedNode(LDP.DirectContainer));
    }
  }
}
