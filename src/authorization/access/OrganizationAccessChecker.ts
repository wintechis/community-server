import type { Store, Term } from 'n3';
import type { ResourceIdentifier } from '../../http/representation/ResourceIdentifier';
import type { ExpiringStorage } from '../../storage/keyvalue/ExpiringStorage';
import { fetchDataset } from '../../util/FetchUtil';
import { promiseSome } from '../../util/PromiseUtil';
import { readableToQuads } from '../../util/StreamUtil';
import { ACL, ORG } from '../../util/Vocabularies';
import type { AccessCheckerArgs } from './AccessChecker';
import { AccessChecker } from './AccessChecker';

/**
 * Checks if the given WebID is member of an organization that has access.
 *
 * Fetched results will be stored in an ExpiringStorage.
 *
 * Requires a storage that can store JS objects.
 * `expiration` parameter is how long entries in the cache should be stored in seconds, defaults to 3600.
 */
export class AgentGroupAccessChecker extends AccessChecker {
  private readonly cache: ExpiringStorage<string, Promise<Store>>;
  private readonly expiration: number;

  public constructor(cache: ExpiringStorage<string, Promise<Store>>, expiration = 3600) {
    super();
    this.cache = cache;
    this.expiration = expiration * 1000;
  }

  public async handle({ acl, rule, credential }: AccessCheckerArgs): Promise<boolean> {
    if (typeof credential.webId === 'string') {
      const { webId } = credential;
      const memberOf = acl.getObjects(rule, ACL.terms.memberOfOrganization, null);

      return await promiseSome(memberOf.map(async(organization: Term): Promise<boolean> =>
        this.isMemberOfOrganization(webId, organization)));
    }
    return false;
  }

  /**
   * Checks if the given agent is member of a given org Organization.
   * @param webId - WebID of the agent that needs access.
   * @param organization - URL of the organization that needs to be checked.
   *
   * @returns If the agent is member of the given organization.
   */
  private async isMemberOfOrganization(webId: string, organization: Term): Promise<boolean> {
    const groupDocument: ResourceIdentifier = { path: /^[^#]*/u.exec(organization.value)![0] };

    // Fetch the required organization
    const quads = await this.fetchCachedQuads(groupDocument.path);
    return quads.countQuads(organization, ORG.terms.hasMember, webId, null) !== 0;
  }

  /**
   * Fetches quads from the given URL.
   * Will cache the values for later re-use.
   */
  private async fetchCachedQuads(url: string): Promise<Store> {
    let result = await this.cache.get(url);
    if (!result) {
      const prom = (async(): Promise<Store> => {
        const representation = await fetchDataset(url);
        return readableToQuads(representation.data);
      })();
      await this.cache.set(url, prom, this.expiration);
      result = await prom;
    }
    return result;
  }
}
