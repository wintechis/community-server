import type { InteractionResults } from 'oidc-provider';
import type { InteractionCompleterInput } from './InteractionCompleter';
import { InteractionCompleter } from './InteractionCompleter';

/**
 *  Creates a simple InteractionResults object based on the input parameters and injects it in the Interaction.
 */
export class BaseInteractionCompleter extends InteractionCompleter {
  public async handle(input: InteractionCompleterInput): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const result: InteractionResults = {
      login: {
        account: input.webId,
        remember: input.shouldRemember,
        ts: now,
      },
      consent: {
        rejectedScopes: input.shouldRemember ? [] : [ 'offline_access' ],
      },
    };

    // Identical behaviour to calling `provider.interactionResult`
    const { oidcInteraction } = input;
    oidcInteraction.result = { ...oidcInteraction.lastSubmission, ...result };
    await oidcInteraction.save(oidcInteraction.exp - now);

    return oidcInteraction.returnTo;
  }
}
