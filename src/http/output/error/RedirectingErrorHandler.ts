import { NotImplementedHttpError } from '../../../util/errors/NotImplementedHttpError';
import { RedirectHttpError } from '../../../util/errors/RedirectHttpError';
import { RedirectResponseDescription } from '../response/RedirectResponseDescription';
import type { ResponseDescription } from '../response/ResponseDescription';
import type { ErrorHandlerArgs } from './ErrorHandler';
import { ErrorHandler } from './ErrorHandler';

/**
 * Error handler that converts {@link RedirectHttpError}s to {@link RedirectResponseDescription}s.
 */
export class RedirectingErrorHandler extends ErrorHandler {
  public async canHandle({ error }: ErrorHandlerArgs): Promise<void> {
    if (!RedirectHttpError.isInstance(error)) {
      throw new NotImplementedHttpError('Only redirect errors are supported.');
    }
  }

  public async handle({ error }: ErrorHandlerArgs): Promise<ResponseDescription> {
    // Cast verified by canHandle
    return new RedirectResponseDescription(error as RedirectHttpError);
  }
}
