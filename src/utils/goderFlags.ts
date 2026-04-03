/**
 * Goder Code feature flag helpers.
 *
 * When GrowthBook is unavailable (the normal case in this fork), the
 * growthbook module calls these helpers to resolve feature values:
 *
 *   1. getGoderOverride(name)  — env-var override: GODER_FLAG_<NAME>=<json>
 *   2. getGoderDefault(name, fallback) — hardcoded Goder defaults, then fallback
 *
 * isAutonomousMode() is used by the permissions layer to skip interactive
 * prompts when the user launched with --proactive.
 */

/**
 * Hardcoded Goder defaults for feature flags whose GrowthBook key is
 * disabled/failing but the feature should remain ON for this fork.
 *
 * These are ONLY consulted when `isGrowthBookEnabled()` returns false
 * (i.e. analytics are disabled, no remote eval available).
 *
 * IMPORTANT: The keys here must match the actual GB feature name used in
 * callers of `getFeatureValue_CACHED_MAY_BE_STALE` — e.g. `tengu_passport_quail`,
 * NOT "extract_memories".
 *
 * Most Goder features bypass this mechanism: extract_memories uses the
 * GODER_EXTRACT_MEMORIES env var; away_summary is enabled by default in
 * useAwaySummary.ts.  This table is intentionally empty — add entries only
 * when a feature needs a fallback that isn't already handled in-code.
 */
const GODER_DEFAULTS: Record<string, unknown> = {}

/**
 * Look up a per-feature env-var override.
 *
 * Convention: `GODER_FLAG_<UPPERCASED_NAME>` where dots/hyphens become
 * underscores.  The value is JSON-parsed so booleans and numbers work;
 * bare strings are treated as `true`.
 *
 * Returns `undefined` when no override is set.
 */
export function getGoderOverride(feature: string): unknown {
  const envKey = `GODER_FLAG_${feature.replace(/[.\-]/g, '_').toUpperCase()}`
  const raw = process.env[envKey]
  if (raw === undefined) return undefined
  try {
    return JSON.parse(raw)
  } catch {
    // Bare non-JSON value — treat as truthy string.
    return true
  }
}

/**
 * Return the Goder-specific default for a feature, falling back to the
 * caller's `defaultValue` if no Goder default is defined.
 */
export function getGoderDefault<T>(feature: string, defaultValue: T): T {
  if (feature in GODER_DEFAULTS) {
    return GODER_DEFAULTS[feature] as T
  }
  return defaultValue
}

/**
 * True when Goder Code is running in autonomous / proactive mode.
 *
 * Checked by the permissions layer to bypass interactive permission prompts
 * (equivalent to `--dangerously-skip-permissions`).
 *
 * Detection: the `--proactive` CLI flag sets the `PROACTIVE` env var via
 * main.tsx before any tool permission check runs.
 */
export function isAutonomousMode(): boolean {
  return (
    process.env.GODER_AUTONOMOUS === '1' ||
    process.env.GODER_AUTONOMOUS === 'true' ||
    // --proactive flag is stored in Commander's parsed options and forwarded
    // as an env var by main.tsx's startup path.
    process.env.CLAUDE_PROACTIVE === '1' ||
    process.env.CLAUDE_PROACTIVE === 'true'
  )
}
