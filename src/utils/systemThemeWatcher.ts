/**
 * Watches the terminal's background color via OSC 11 and updates the
 * cached system theme when the user switches between dark/light mode.
 *
 * Uses the TerminalQuerier to send OSC 11 queries on a polling interval.
 * The first query fires immediately (so 'auto' resolves quickly); after
 * that we poll every 5 seconds — fast enough to feel live, slow enough
 * to avoid noticeable overhead.
 *
 * The watcher is only active when themeSetting === 'auto'. ThemeProvider
 * starts/stops it via a useEffect that depends on activeSetting.
 */

import type { TerminalQuerier } from '../ink/terminal-querier.js'
import { oscColor } from '../ink/terminal-querier.js'
import { setCachedSystemTheme, themeFromOscColor, type SystemTheme } from './systemTheme.js'

const POLL_INTERVAL_MS = 5_000

/**
 * Start watching the terminal background color for dark/light changes.
 * Returns a cleanup function that stops the watcher.
 *
 * @param querier — the TerminalQuerier from StdinContext (must not be null)
 * @param setTheme — React setState callback to update the resolved theme
 */
export function watchSystemTheme(
  querier: TerminalQuerier,
  setTheme: (theme: SystemTheme) => void,
): () => void {
  let timer: ReturnType<typeof setInterval> | undefined
  let stopped = false

  async function poll(): Promise<void> {
    if (stopped) return
    // send() + flush() together: flush writes the DA1 sentinel that acts
    // as a barrier — if the terminal doesn't respond to our OSC 11 before
    // DA1 arrives, send() resolves with undefined (unsupported).
    const [response] = await Promise.all([
      querier.send(oscColor(11)),
      querier.flush(),
    ])
    if (stopped) return
    if (response?.type === 'osc' && response.code === 11 && response.data) {
      const theme = themeFromOscColor(response.data)
      if (theme) {
        setCachedSystemTheme(theme)
        setTheme(theme)
      }
    }
  }

  // Fire first query immediately, then start polling
  poll().catch(() => {})
  timer = setInterval(() => { poll().catch(() => {}) }, POLL_INTERVAL_MS)

  return () => {
    stopped = true
    if (timer !== undefined) {
      clearInterval(timer)
    }
  }
}
