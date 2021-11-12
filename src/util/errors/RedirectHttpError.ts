import type { HttpErrorOptions } from './HttpError';
import { HttpError } from './HttpError';

/**
 * Abstract class representing an error that implies that a redirect should take place.
 */
export abstract class RedirectHttpError extends HttpError {
  public readonly location: string;

  protected constructor(statusCode: number, location: string, name: string, message?: string,
    options?: HttpErrorOptions) {
    super(statusCode, name, message, options);
    this.location = location;
  }

  public static isInstance(error: any): error is RedirectHttpError {
    return HttpError.isInstance(error) && typeof (error as any).location === 'string';
  }
}
