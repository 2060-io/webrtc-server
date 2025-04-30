/**
 * Returns a safe string message from any thrown value.
 */
export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Returns both message and stack trace (if available) from any thrown value.
 * Useful for logging errors in depth.
 */
export function getErrorDetails(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) {
    return { message: error.message, stack: error.stack }
  }
  return { message: String(error) }
}
