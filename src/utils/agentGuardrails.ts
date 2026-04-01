/**
 * Safety guardrails for the agent loop.
 *
 * Prevents runaway API costs, infinite tool-call loops, and cascading errors
 * by enforcing configurable limits on turns, spend, repetition, and
 * consecutive failures. Designed to be called from the main query loop in
 * `src/query.ts` without adding any external dependencies.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Result of a guardrail check — either the loop may proceed or must stop. */
export type GuardrailCheck =
  | { proceed: true }
  | {
      proceed: false
      reason: string
      type: 'max_turns' | 'max_cost' | 'loop_detected' | 'too_many_errors'
    }

/** Snapshot of current guardrail counters, useful for logging / telemetry. */
export interface GuardrailStats {
  turnCount: number
  costUSD: number
  consecutiveSameToolCalls: number
  consecutiveErrors: number
  maxTurns: number
  maxCostUSD: number
  maxConsecutiveSameToolCalls: number
  maxConsecutiveErrors: number
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Parse a numeric env var, returning `fallback` when absent or invalid. */
function envNumber(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

/**
 * Cheap fingerprint for a tool call.
 *
 * Full hashing is unnecessary — we only need to detect *consecutive*
 * identical calls inside a small sliding window, so truncating the input
 * to 200 characters is sufficient and avoids allocating large strings.
 */
function toolCallKey(name: string, input: string): string {
  return name + ':' + input.slice(0, 200)
}

// ---------------------------------------------------------------------------
// Per-million-token pricing used for cost estimation
// ---------------------------------------------------------------------------

interface TokenPricing {
  inputPerMillion: number
  outputPerMillion: number
}

const CLAUDE_PRICING: TokenPricing = { inputPerMillion: 3, outputPerMillion: 15 }
const OPENAI_COMPAT_PRICING: TokenPricing = { inputPerMillion: 1, outputPerMillion: 3 }

function getActivePricing(): TokenPricing {
  return process.env.CLAUDE_CODE_USE_OPENAI_COMPAT ? OPENAI_COMPAT_PRICING : CLAUDE_PRICING
}

// ---------------------------------------------------------------------------
// AgentGuardrails
// ---------------------------------------------------------------------------

export interface AgentGuardrailsOptions {
  maxTurns?: number
  maxCostUSD?: number
  maxConsecutiveSameToolCalls?: number
  maxConsecutiveErrors?: number
}

/**
 * Stateful safety monitor for the agent turn loop.
 *
 * Create one instance per conversation and call the appropriate `record*`
 * and `check*` methods at each stage of the loop. The class is intentionally
 * side-effect-free (no I/O, no timers) so it can be unit-tested trivially.
 *
 * @example
 * ```ts
 * const guard = new AgentGuardrails({ maxTurns: 50 })
 *
 * while (true) {
 *   const pre = guard.checkBeforeTurn(turn, costSoFar)
 *   if (!pre.proceed) { console.warn(pre.reason); break }
 *   // ... call API, run tools ...
 *   const post = guard.recordToolCall(name, JSON.stringify(input))
 *   if (!post.proceed) { console.warn(post.reason); break }
 * }
 * ```
 */
export class AgentGuardrails {
  // Limits
  readonly maxTurns: number
  readonly maxCostUSD: number
  readonly maxConsecutiveSameToolCalls: number
  readonly maxConsecutiveErrors: number

  // Mutable state
  private _consecutiveErrors = 0
  private _toolWindow: string[] = [] // sliding window of tool-call keys
  private readonly WINDOW_SIZE = 10

  constructor(options?: AgentGuardrailsOptions) {
    this.maxTurns = options?.maxTurns ?? envNumber('GODER_MAX_TURNS', 100)
    this.maxCostUSD = options?.maxCostUSD ?? envNumber('GODER_MAX_BUDGET_USD', 5.0)
    this.maxConsecutiveSameToolCalls =
      options?.maxConsecutiveSameToolCalls ?? envNumber('GODER_MAX_SAME_TOOL_CALLS', 5)
    this.maxConsecutiveErrors = options?.maxConsecutiveErrors ?? 3
  }

  // -----------------------------------------------------------------------
  // Pre-turn check
  // -----------------------------------------------------------------------

  /**
   * Validate that the loop is safe to continue before issuing the next API
   * request. Should be called at the top of each iteration.
   */
  checkBeforeTurn(turnCount: number, costSoFar: number): GuardrailCheck {
    if (turnCount >= this.maxTurns) {
      return {
        proceed: false,
        reason: `Turn limit reached (${turnCount}/${this.maxTurns}). Stopping to prevent runaway execution.`,
        type: 'max_turns',
      }
    }

    if (costSoFar >= this.maxCostUSD) {
      return {
        proceed: false,
        reason: `Cost budget exhausted ($${costSoFar.toFixed(2)} >= $${this.maxCostUSD.toFixed(2)}). Stopping to prevent overspend.`,
        type: 'max_cost',
      }
    }

    return { proceed: true }
  }

  // -----------------------------------------------------------------------
  // Tool-call tracking (loop detection)
  // -----------------------------------------------------------------------

  /**
   * Record a tool invocation and check for repetitive patterns.
   *
   * Maintains a sliding window of the last {@link WINDOW_SIZE} calls. If the
   * most recent N calls (where N = `maxConsecutiveSameToolCalls`) all share
   * the same fingerprint, the check fails.
   */
  recordToolCall(toolName: string, toolInput: string): GuardrailCheck {
    const key = toolCallKey(toolName, toolInput)

    this._toolWindow.push(key)
    if (this._toolWindow.length > this.WINDOW_SIZE) {
      this._toolWindow.shift()
    }

    // Check the tail of the window for consecutive identical calls.
    const threshold = this.maxConsecutiveSameToolCalls
    if (this._toolWindow.length >= threshold) {
      const tail = this._toolWindow.slice(-threshold)
      const allSame = tail.every((k) => k === tail[0])
      if (allSame) {
        return {
          proceed: false,
          reason:
            `Loop detected: tool "${toolName}" called ${threshold} times consecutively with the same input. ` +
            'Stopping to avoid an infinite loop.',
          type: 'loop_detected',
        }
      }
    }

    return { proceed: true }
  }

  // -----------------------------------------------------------------------
  // Error tracking
  // -----------------------------------------------------------------------

  /** Record a failed API response or tool error. */
  recordError(): GuardrailCheck {
    this._consecutiveErrors++

    if (this._consecutiveErrors >= this.maxConsecutiveErrors) {
      return {
        proceed: false,
        reason:
          `${this._consecutiveErrors} consecutive errors encountered (limit: ${this.maxConsecutiveErrors}). ` +
          'Stopping to avoid burning budget on repeated failures.',
        type: 'too_many_errors',
      }
    }

    return { proceed: true }
  }

  /** Record a successful (non-error) API response. Resets the error counter. */
  recordSuccess(): void {
    this._consecutiveErrors = 0
  }

  // -----------------------------------------------------------------------
  // Observability
  // -----------------------------------------------------------------------

  /** Return a snapshot of the current guardrail state for logging. */
  getStats(): GuardrailStats {
    // Consecutive-same count: length of the longest suffix of identical keys.
    let consecutiveSame = 0
    if (this._toolWindow.length > 0) {
      const last = this._toolWindow[this._toolWindow.length - 1]!
      for (let i = this._toolWindow.length - 1; i >= 0; i--) {
        if (this._toolWindow[i] === last) {
          consecutiveSame++
        } else {
          break
        }
      }
    }

    return {
      turnCount: this._toolWindow.length,
      costUSD: 0, // caller tracks cost externally
      consecutiveSameToolCalls: consecutiveSame,
      consecutiveErrors: this._consecutiveErrors,
      maxTurns: this.maxTurns,
      maxCostUSD: this.maxCostUSD,
      maxConsecutiveSameToolCalls: this.maxConsecutiveSameToolCalls,
      maxConsecutiveErrors: this.maxConsecutiveErrors,
    }
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  /** Reset all mutable state. Call when starting a new conversation. */
  reset(): void {
    this._consecutiveErrors = 0
    this._toolWindow = []
  }
}

// ---------------------------------------------------------------------------
// Cost estimation helper (standalone, usable outside the class)
// ---------------------------------------------------------------------------

/**
 * Estimate the USD cost of a single API exchange.
 *
 * Uses conservative per-million-token rates. When the env var
 * `CLAUDE_CODE_USE_OPENAI_COMPAT` is set, cheaper OpenAI-compatible pricing
 * is used instead of Anthropic pricing.
 */
export function estimateCostUSD(inputTokens: number, outputTokens: number): number {
  const pricing = getActivePricing()
  return (
    (inputTokens * pricing.inputPerMillion + outputTokens * pricing.outputPerMillion) / 1_000_000
  )
}
