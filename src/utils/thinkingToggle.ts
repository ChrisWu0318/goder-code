/**
 * Goder Code thinking mode toggle.
 *
 * Users can enable forcing thinking on for the current session via /thinking.
 * This is session-scoped and resets when the session ends.
 */

let thinkingEnabled = false

export function setThinkingEnabled(enabled: boolean): void {
  thinkingEnabled = enabled
}

export function toggleThinking(): boolean {
  thinkingEnabled = !thinkingEnabled
  return thinkingEnabled
}

export function isThinkingForced(): boolean {
  return thinkingEnabled
}
