export class NonRetryableError extends Error {
  readonly retryable = false

  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'NonRetryableError'
  }
}

export function isRetryableJobError(error: unknown): boolean {
  return !(typeof error === 'object' && error !== null && 'retryable' in error && error.retryable === false)
}
