/**
 * Command filtering system for BashTool.
 *
 * Enforces configurable allow/deny lists at the command level, sourced from
 * environment variables and ~/.claude/settings.json.  A built-in safety deny
 * list is always active and cannot be overridden.
 *
 * Config sources (merged — all entries from every source are combined):
 *   - Env vars: GODER_BASH_ALLOW / GODER_BASH_DENY  (comma-separated)
 *   - ~/.claude/settings.json  ->  bash.allowPatterns / bash.denyPatterns
 *
 * Pattern syntax:
 *   - exact string  ->  exact match          ("ls" matches only "ls")
 *   - trailing *    ->  prefix match          ("git*" matches "git status")
 *   - /regex/       ->  regular expression    ("/rm\s+-rf/" matches "rm  -rf /tmp")
 */

import { readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FilterResult {
  allowed: boolean
  reason?: string
}

export interface FilterConfig {
  allowPatterns: string[]
  denyPatterns: string[]
}

// ---------------------------------------------------------------------------
// Built-in safety deny list (always enforced, cannot be overridden)
// ---------------------------------------------------------------------------

export const BUILTIN_DENY_PATTERNS: ReadonlyArray<{
  pattern: RegExp
  label: string
}> = [
  // rm -rf / and variants
  {
    pattern: /\brm\s+(-[^\s]*\s+)*-rf\s+\/(\s|$|;)/,
    label: 'rm -rf /',
  },
  {
    pattern: /\brm\s+(-[^\s]*\s+)*-fr\s+\/(\s|$|;)/,
    label: 'rm -fr /',
  },
  {
    pattern: /\brm\s+.*--no-preserve-root/,
    label: 'rm --no-preserve-root',
  },

  // mkfs on any device
  { pattern: /\bmkfs\b/, label: 'mkfs' },

  // dd if=*/dev/* writing to block devices
  {
    pattern: /\bdd\s+.*if=\S*\/dev\/\S*/,
    label: 'dd targeting block device',
  },

  // chmod -R 777 /
  {
    pattern: /\bchmod\s+(-[^\s]*\s+)*-R\s+777\s+\/(\s|$|;)/,
    label: 'chmod -R 777 /',
  },

  // fork bomb  :(){ :|:& };:
  {
    pattern: /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/,
    label: 'fork bomb',
  },
]

// ---------------------------------------------------------------------------
// Pattern matching helpers
// ---------------------------------------------------------------------------

/**
 * Parse a single user-supplied pattern string into a test function.
 *
 * Supported forms:
 *   - /regex/   ->  treated as a RegExp
 *   - foo*      ->  prefix match (everything before the trailing *)
 *   - foo       ->  exact match
 */
function compilePattern(raw: string): (cmd: string) => boolean {
  const trimmed = raw.trim()
  if (!trimmed) {
    return () => false
  }

  // Regex pattern: /pattern/
  if (trimmed.startsWith('/') && trimmed.endsWith('/') && trimmed.length > 2) {
    try {
      const re = new RegExp(trimmed.slice(1, -1))
      return (cmd: string) => re.test(cmd)
    } catch {
      // Malformed regex — fall through to exact match
      return (cmd: string) => cmd === trimmed
    }
  }

  // Prefix/glob pattern: ends with *
  if (trimmed.endsWith('*')) {
    const prefix = trimmed.slice(0, -1)
    return (cmd: string) => cmd.startsWith(prefix)
  }

  // Exact match
  return (cmd: string) => cmd === trimmed
}

// ---------------------------------------------------------------------------
// Configuration reading
// ---------------------------------------------------------------------------

function readSettingsFile(): Record<string, unknown> | null {
  const configDir = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude')
  const settingsPath = join(configDir, 'settings.json')
  try {
    const raw = readFileSync(settingsPath, 'utf-8')
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    // File missing, unreadable, or invalid JSON — that is fine.
  }
  return null
}

function parseStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === 'string')
  }
  return []
}

function parseEnvList(envVar: string | undefined): string[] {
  if (!envVar) {
    return []
  }
  return envVar
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
}

/**
 * Read and merge the allow/deny configuration from all sources.
 *
 * Both sources are unioned — all entries from every source are combined:
 *   1. ~/.claude/settings.json  bash.allowPatterns / bash.denyPatterns
 *   2. Environment variables    GODER_BASH_ALLOW / GODER_BASH_DENY
 */
export function getFilterConfig(): FilterConfig {
  const allowPatterns: string[] = []
  const denyPatterns: string[] = []

  // --- settings.json ---
  const settings = readSettingsFile()
  if (settings) {
    const bash = settings['bash']
    if (bash && typeof bash === 'object' && !Array.isArray(bash)) {
      const bashObj = bash as Record<string, unknown>
      allowPatterns.push(...parseStringArray(bashObj['allowPatterns']))
      denyPatterns.push(...parseStringArray(bashObj['denyPatterns']))
    }
  }

  // --- environment variables (appended so they always participate) ---
  allowPatterns.push(...parseEnvList(process.env.GODER_BASH_ALLOW))
  denyPatterns.push(...parseEnvList(process.env.GODER_BASH_DENY))

  return { allowPatterns, denyPatterns }
}

// ---------------------------------------------------------------------------
// Core filtering function
// ---------------------------------------------------------------------------

/**
 * Determine whether a bash command is allowed to execute.
 *
 * Evaluation order:
 *   1. Built-in safety deny list (always checked, cannot be bypassed).
 *   2. User-configured deny patterns — if any match, the command is blocked.
 *   3. User-configured allow patterns — if the list is non-empty the command
 *      must match at least one entry; otherwise it is blocked.
 *   4. If neither list has entries, the command is allowed (backward compat).
 */
export function filterCommand(command: string): FilterResult {
  const cmd = command.trim()
  if (!cmd) {
    return { allowed: true }
  }

  // 1. Built-in safety deny list
  for (const entry of BUILTIN_DENY_PATTERNS) {
    if (entry.pattern.test(cmd)) {
      return {
        allowed: false,
        reason: `Blocked by built-in safety rule: ${entry.label}`,
      }
    }
  }

  const { allowPatterns, denyPatterns } = getFilterConfig()

  // 2. User deny list — checked first
  if (denyPatterns.length > 0) {
    for (const raw of denyPatterns) {
      if (compilePattern(raw)(cmd)) {
        return {
          allowed: false,
          reason: `Blocked by deny pattern: ${raw}`,
        }
      }
    }
  }

  // 3. User allow list — command must match at least one
  if (allowPatterns.length > 0) {
    const isAllowed = allowPatterns.some(raw => compilePattern(raw)(cmd))
    if (!isAllowed) {
      return {
        allowed: false,
        reason: 'Command does not match any allow pattern',
      }
    }
  }

  // 4. No lists configured — allow everything
  return { allowed: true }
}
