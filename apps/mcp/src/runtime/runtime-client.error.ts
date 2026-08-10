export class RuntimeClientError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
    readonly details?: unknown,
    readonly httpStatus?: number,
  ) {
    super(message);
    this.name = "RuntimeClientError";
  }
}
