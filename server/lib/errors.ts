/** An error with an HTTP status and a message that is safe to show the visitor. */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = 'error',
    public details?: unknown,
  ) {
    super(message)
  }
}

export const badRequest = (msg: string, details?: unknown) => new HttpError(400, msg, 'bad_request', details)
export const unauthorized = () => new HttpError(401, 'Please sign in to continue.', 'unauthorized')
export const forbidden = () => new HttpError(403, 'You do not have access to this.', 'forbidden')
export const notFound = (what = 'That item') => new HttpError(404, `${what} was not found.`, 'not_found')
export const conflict = (msg: string, code = 'conflict') => new HttpError(409, msg, code)
