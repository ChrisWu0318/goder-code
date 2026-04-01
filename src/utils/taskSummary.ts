import { isBgSession } from './concurrentSessions.js'

/**
 * Whether the current session should periodically generate task summaries.
 * Only bg sessions benefit from this — interactive sessions show output directly.
 */
export function shouldGenerateTaskSummary(): boolean {
  return isBgSession()
}

/**
 * Placeholder for periodic task summary generation.
 * In a full implementation this would fork a lightweight API call to
 * summarize the current conversation and write it to the session's PID file
 * so `claude ps` can display a one-line status.
 */
export function maybeGenerateTaskSummary(
  _options: Record<string, unknown>,
): void {
  // TODO: Implement summary generation via a lightweight API call.
  // For now this is a safe no-op — bg sessions still function, they
  // just won't surface a live summary in `claude ps`.
}
