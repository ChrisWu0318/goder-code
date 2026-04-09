/**
 * Goder Code Internal HUD Renderer
 *
 * Self-contained statusline renderer ported from claude-hud.
 * Takes StatusLineCommandInput (already built by StatusLine.tsx) and
 * returns ANSI-formatted strings for terminal display.
 *
 * No external process, no stdin/stdout pipe — pure function call.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

// ---- ANSI Colors ----

const RESET = '\x1b[0m'
const DIM = '\x1b[2m'
const RED = '\x1b[31m'
const GREEN = '\x1b[32m'
const YELLOW = '\x1b[33m'
const MAGENTA = '\x1b[35m'
const CYAN = '\x1b[36m'
const BRIGHT_BLUE = '\x1b[94m'
const BRIGHT_MAGENTA = '\x1b[95m'
const BRIGHT_YELLOW = '\x1b[93m'
const BOLD = '\x1b[1m'

function colorize(text: string, color: string): string {
  return `${color}${text}${RESET}`
}

const c = {
  dim: (t: string) => colorize(t, DIM),
  red: (t: string) => colorize(t, RED),
  green: (t: string) => colorize(t, GREEN),
  yellow: (t: string) => colorize(t, YELLOW),
  magenta: (t: string) => colorize(t, MAGENTA),
  cyan: (t: string) => colorize(t, CYAN),
  bright: (t: string) => colorize(t, BRIGHT_YELLOW),
}

function getContextColor(percent: number): string {
  if (percent >= 85) return RED
  if (percent >= 70) return YELLOW
  return GREEN
}

function getQuotaColor(percent: number): string {
  if (percent >= 90) return RED
  if (percent >= 75) return BRIGHT_MAGENTA
  return BRIGHT_BLUE
}

function coloredBar(percent: number, width = 10): string {
  const safePercent = Math.min(100, Math.max(0, percent || 0))
  const filled = Math.round((safePercent / 100) * width)
  const empty = width - filled
  const color = getContextColor(safePercent)
  return `${color}${'█'.repeat(filled)}${DIM}${'░'.repeat(empty)}${RESET}`
}

function quotaBar(percent: number, width = 10): string {
  const safePercent = Math.min(100, Math.max(0, percent || 0))
  const filled = Math.round((safePercent / 100) * width)
  const empty = width - filled
  const color = getQuotaColor(safePercent)
  return `${color}${'█'.repeat(filled)}${DIM}${'░'.repeat(empty)}${RESET}`
}

// ---- Data Helpers ----

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`
  return n.toString()
}

function formatDuration(ms: number): string {
  const mins = Math.floor(ms / 60_000)
  if (mins < 1) return '<1m'
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  const rem = mins % 60
  return `${hours}h ${rem}m`
}

function formatResetTime(resetAtSec: number): string {
  const diffMs = resetAtSec * 1000 - Date.now()
  if (diffMs <= 0) return ''
  const mins = Math.ceil(diffMs / 60_000)
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  const m = mins % 60
  if (hours >= 24) {
    const days = Math.floor(hours / 24)
    const rh = hours % 24
    return rh > 0 ? `${days}d ${rh}h` : `${days}d`
  }
  return m > 0 ? `${hours}h ${m}m` : `${hours}h`
}

function formatElapsed(startMs: number, endMs?: number): string {
  const ms = (endMs ?? Date.now()) - startMs
  if (ms < 1000) return '<1s'
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`
  const mins = Math.floor(ms / 60_000)
  const secs = Math.round((ms % 60_000) / 1000)
  return `${mins}m ${secs}s`
}

// ---- Git ----

interface GitStatus {
  branch: string
  isDirty: boolean
  ahead: number
  behind: number
}

async function getGitStatus(cwd: string): Promise<GitStatus | null> {
  try {
    const { stdout: branchOut } = await execFileAsync(
      'git',
      ['rev-parse', '--abbrev-ref', 'HEAD'],
      { cwd, timeout: 1000, encoding: 'utf8' },
    )
    const branch = branchOut.trim()
    if (!branch) return null

    let isDirty = false
    try {
      const { stdout: statusOut } = await execFileAsync(
        'git',
        ['--no-optional-locks', 'status', '--porcelain'],
        { cwd, timeout: 1000, encoding: 'utf8' },
      )
      isDirty = statusOut.trim().length > 0
    } catch {
      /* ignore */
    }

    let ahead = 0
    let behind = 0
    try {
      const { stdout: revOut } = await execFileAsync(
        'git',
        ['rev-list', '--left-right', '--count', '@{upstream}...HEAD'],
        { cwd, timeout: 1000, encoding: 'utf8' },
      )
      const parts = revOut.trim().split(/\s+/)
      if (parts.length === 2) {
        behind = parseInt(parts[0], 10) || 0
        ahead = parseInt(parts[1], 10) || 0
      }
    } catch {
      /* no upstream */
    }

    return { branch, isDirty, ahead, behind }
  } catch {
    return null
  }
}

// ---- Transcript Parsing (lightweight) ----

interface ToolEntry {
  name: string
  target?: string
  status: 'running' | 'completed'
}

interface AgentEntry {
  type: string
  model?: string
  description?: string
  status: 'running' | 'completed'
  startMs: number
  endMs?: number
}

interface TranscriptInfo {
  tools: ToolEntry[]
  agents: AgentEntry[]
  sessionStartMs?: number
}

function parseTranscriptSync(transcriptPath: string): TranscriptInfo {
  const result: TranscriptInfo = { tools: [], agents: [] }
  if (!transcriptPath) return result

  try {
    const fs = require('node:fs') as typeof import('node:fs')
    const content = fs.readFileSync(transcriptPath, 'utf8')
    const lines = content.split('\n').filter(Boolean)

    const toolUseMap = new Map<string, { name: string; target?: string }>()
    const agentMap = new Map<string, AgentEntry>()

    for (const line of lines) {
      try {
        const msg = JSON.parse(line)

        // Track session start
        if (!result.sessionStartMs && msg.timestamp) {
          result.sessionStartMs = new Date(msg.timestamp).getTime()
        }

        // Parse assistant messages for tool_use blocks
        if (msg.type === 'assistant' && msg.message?.content) {
          for (const block of msg.message.content) {
            if (block.type === 'tool_use') {
              const toolName = block.name || 'Unknown'
              const target =
                block.input?.file_path ||
                block.input?.command?.slice(0, 30) ||
                undefined
              toolUseMap.set(block.id, { name: toolName, target })

              // Track Agent tool calls as agents
              if (
                toolName === 'Agent' &&
                block.input?.prompt
              ) {
                agentMap.set(block.id, {
                  type:
                    block.input.subagent_type || 'general-purpose',
                  model: block.input.model,
                  description:
                    block.input.description || block.input.prompt?.slice(0, 40),
                  status: 'running',
                  startMs: msg.timestamp
                    ? new Date(msg.timestamp).getTime()
                    : Date.now(),
                })
              }
            }
          }
        }

        // Parse tool results to mark tools as completed
        if (msg.type === 'user' && msg.message?.content) {
          const content = Array.isArray(msg.message.content)
            ? msg.message.content
            : []
          for (const block of content) {
            if (block.type === 'tool_result' && block.tool_use_id) {
              toolUseMap.delete(block.tool_use_id)
              const agent = agentMap.get(block.tool_use_id)
              if (agent) {
                agent.status = 'completed'
                agent.endMs = msg.timestamp
                  ? new Date(msg.timestamp).getTime()
                  : Date.now()
              }
            }
          }
        }
      } catch {
        /* skip bad lines */
      }
    }

    // Remaining tool_use without matching result = running
    for (const [, tool] of toolUseMap) {
      result.tools.push({ ...tool, status: 'running' })
    }

    // Collect agents
    result.agents = Array.from(agentMap.values())
  } catch {
    /* file not readable */
  }

  return result
}

// ---- Extended HUD Types ----

interface HudMcpServer {
  name: string
  status: 'running' | 'stopped' | 'error'
  tools?: number
}

interface HudSwarmStatus {
  active: boolean
  agents?: number
  maxAgents?: number
  topology?: string
}

interface HudDddStatus {
  domains?: string[]
  completed?: number
  total?: number
}

interface HudArchitectureStatus {
  adrCount?: number
  adrTotal?: number
  dddPercent?: number
  securityStatus?: 'pending' | 'scanning' | 'clear' | 'issue'
}

interface HudAgentDbStatus {
  vectors?: number
  sizeKb?: number
  tests?: number
  testCases?: number
}

interface HudCveStatus {
  scanned?: number
  vulnerabilities?: number
}

interface HudHooksStatus {
  active?: number
  total?: number
}

interface HudMemoryStatus {
  usedMb?: number
  percent?: number
}

interface HudBrainStatus {
  usedPercent?: number
}

// ---- Main Renderer ----

/** StatusLineCommandInput — matches what StatusLine.tsx builds */
interface HudInput {
  session_id?: string
  session_name?: string
  transcript_path?: string
  cwd?: string
  model?: { id?: string; display_name?: string }
  workspace?: { current_dir?: string; project_dir?: string }
  active_project?: { name: string; id: string } | null
  version?: string
  cost?: { total_cost_usd?: number; total_duration_ms?: number }
  context_window?: {
    total_input_tokens?: number
    total_output_tokens?: number
    context_window_size?: number
    current_usage?: {
      input_tokens?: number
      output_tokens?: number
      cache_creation_input_tokens?: number
      cache_read_input_tokens?: number
    } | null
    used_percentage?: number | null
    remaining_percentage?: number | null
  }
  rate_limits?: {
    five_hour?: { used_percentage?: number; resets_at?: number }
    seven_day?: { used_percentage?: number; resets_at?: number }
  }
  effort?: string
  // Extended HUD fields
  hud?: {
    brand?: string
    user?: string
    mcp?: HudMcpServer[]
    swarm?: HudSwarmStatus
    ddd?: HudDddStatus
    architecture?: HudArchitectureStatus
    agentdb?: HudAgentDbStatus
    cve?: HudCveStatus
    hooks?: HudHooksStatus
    memory?: HudMemoryStatus
    brain?: HudBrainStatus
  }
  [key: string]: unknown
}

/**
 * Render HUD statusline from StatusLineCommandInput.
 * Returns multi-line ANSI string ready for display.
 */
export async function renderHud(input: HudInput): Promise<string> {
  const lines: string[] = []
  const cwd = input.workspace?.current_dir || input.cwd || process.cwd()
  const hud = input.hud

  // ---- Line 1 (header): Brand | session | model | elapsed ----
  const header: string[] = []

  // Brand + User
  const brand = hud?.brand || 'Goder'
  const user = hud?.user ? ` \u25CF ${hud.user}` : ''
  header.push(`${c.cyan('\u25A9')} ${c.green(brand)}${user}`)

  // Session name (truncate if > 20 chars)
  if (input.session_name) {
    let name = input.session_name.replace(/[\u2502]/g, '')
    if (name.length > 20) name = name.slice(0, 19) + '\u2026'
    header.push(c.yellow(name))
  }

  // Model (truncate long model names)
  let modelName = input.model?.display_name || input.model?.id || 'Unknown'
  if (modelName.length > 25) modelName = modelName.slice(0, 24) + '\u2026'
  header.push(modelName === 'Unknown' ? c.cyan(modelName) : c.yellow(modelName))

  // Elapsed
  if (input.cost?.total_duration_ms) {
    const ms = input.cost.total_duration_ms
    header.push(c.dim(ms < 60_000 ? `${Math.round(ms / 1000)}s` : formatDuration(ms)))
  }

  lines.push(c.dim('\u250D ') + header.join(c.dim(' \u2502 ')))

  // ---- Line 2 (metrics): git | effort | context | quota ----
  const metrics: string[] = []

  // Git (compact: branch* ±ahead ↓behind)
  const git = await getGitStatus(cwd)
  if (git) {
    const dirty = git.isDirty ? '*' : ''
    const aheadBehind =
      (git.ahead > 0 ? ` \u2191${git.ahead}` : '') +
      (git.behind > 0 ? ` \u2193${git.behind}` : '')
    metrics.push(`${c.cyan(git.branch + dirty)}${aheadBehind ? c.dim(aheadBehind) : ''}`)
  }

  // Effort
  if (input.effort) {
    const effortSymbol = input.effort === 'max' ? '\u25C9' : input.effort === 'high' ? '\u25CF' : input.effort === 'medium' ? '\u25D0' : '\u25CB'
    metrics.push(`${c.bright(effortSymbol)} ${c.dim('effort')}`)
  }

  // Context
  const ctxWindow = input.context_window
  let contextPercent = 0
  if (typeof ctxWindow?.used_percentage === 'number') {
    contextPercent = Math.round(ctxWindow.used_percentage)
  } else if (ctxWindow?.context_window_size && ctxWindow.context_window_size > 0) {
    const totalTokens =
      (ctxWindow.current_usage?.input_tokens ?? 0) +
      (ctxWindow.current_usage?.cache_creation_input_tokens ?? 0) +
      (ctxWindow.current_usage?.cache_read_input_tokens ?? 0)
    contextPercent = Math.min(100, Math.round((totalTokens / ctxWindow.context_window_size) * 100))
  }
  if (contextPercent > 0) {
    const ctxColor = getContextColor(contextPercent)
    metrics.push(`${coloredBar(contextPercent, 6)} ${ctxColor}${contextPercent}%${RESET}`)
  }

  // Context token details when high usage
  if (contextPercent >= 85 && ctxWindow?.current_usage) {
    const inp = formatTokens(ctxWindow.current_usage.input_tokens ?? 0)
    const cache = formatTokens(
      (ctxWindow.current_usage.cache_creation_input_tokens ?? 0) +
        (ctxWindow.current_usage.cache_read_input_tokens ?? 0),
    )
    metrics.push(c.dim(`${inp} in, ${cache} cache`))
  }

  // Quota / rate limits
  const fiveHour = input.rate_limits?.five_hour?.used_percentage
  if (typeof fiveHour === 'number') {
    const fhColor = getQuotaColor(fiveHour)
    metrics.push(`${c.dim('Quota')} ${quotaBar(fiveHour, 6)} ${fhColor}${Math.round(fiveHour)}%${RESET}`)
  }

  // Version
  if (input.version) {
    metrics.push(c.dim(`v${input.version}`))
  }

  if (metrics.length > 0) {
    lines.push(c.dim('\u251C ') + metrics.join(c.dim(' \u2502 ')))
  }

  // ---- Running tools ----
  const transcriptPath = input.transcript_path || ''
  const transcript = parseTranscriptSync(transcriptPath)

  if (transcript.tools.length > 0) {
    const running = transcript.tools.filter((t) => t.status === 'running')
    if (running.length > 0) {
      const toolDisplay = running.slice(-2).map((tool) => {
        const target = tool.target
          ? tool.target.length > 20
            ? '…/' + tool.target.split('/').pop()
            : tool.target
          : ''
        return `${c.yellow('\u25D0')} ${c.cyan(tool.name)}${target ? c.dim(`: ${target}`) : ''}`
      }).join(c.dim(' · '))
      lines.push(c.dim('\u251C ') + toolDisplay)
    }
  }

  // ---- Running agents ----
  const runningAgents = transcript.agents.filter((a) => a.status === 'running')
  if (runningAgents.length > 0) {
    const agentDisplay = runningAgents.slice(-2).map((agent) => {
      const type = c.cyan(agent.type)
      const elapsed = c.dim(`(${formatElapsed(agent.startMs)})`)
      return `${c.yellow('\u25D0')} ${type} ${elapsed}`
    }).join(c.dim(' · '))
    lines.push(c.dim('\u251C ') + agentDisplay)
  }

  // ---- Extended HUD modules (one compact line per module group) ----
  const extLines: string[] = []

  // DDD Domains
  if (hud?.ddd) {
    const total = hud.ddd.total || 0
    const completed = hud.ddd.completed || 0
    extLines.push(`${c.dim('DDD')} [${completed}/${total}]`)
  }

  // Swarm
  if (hud?.swarm) {
    const active = hud.swarm.agents !== undefined ? `${c.yellow(String(hud.swarm.agents))}/${hud.swarm.maxAgents ?? '?'}` : (hud.swarm.active ? c.green('on') : c.dim('off'))
    extLines.push(`${c.dim('Swarm')} ${active}`)
  }

  // Architecture
  if (hud?.architecture) {
    const parts: string[] = []
    if (hud.architecture.adrCount !== undefined) {
      parts.push(`${c.cyan('ADR')} ${hud.architecture.adrCount}/${hud.architecture.adrTotal ?? '?'}`)
    }
    if (hud.architecture.dddPercent !== undefined) {
      parts.push(`${c.magenta('DDD')} ${hud.architecture.dddPercent}%`)
    }
    const secStatus = hud.architecture.securityStatus
    if (secStatus) {
      const secIcon = secStatus === 'clear' ? c.green('\u2713') : secStatus === 'issue' ? c.red('\u2717') : secStatus === 'scanning' ? c.yellow('\u25D2') : c.dim('\u25CB')
      parts.push(`${secIcon} sec`)
    }
    if (parts.length > 0) extLines.push(`${c.dim('Arch')} ${parts.join(c.dim(' · '))}`)
  }

  // AgentDB
  if (hud?.agentdb) {
    const parts: string[] = []
    if (hud.agentdb.vectors !== undefined) parts.push(`vec ${c.cyan(String(hud.agentdb.vectors))}`)
    if (hud.agentdb.sizeKb !== undefined) parts.push(`${Math.round(hud.agentdb.sizeKb / 1024)}MB`)
    if (hud.agentdb.tests !== undefined) parts.push(`test ${c.green(String(hud.agentdb.tests))}`)
    if (parts.length > 0) extLines.push(`${c.dim('AgentDB')} ${parts.join(c.dim(' · '))}`)
  }

  // MCP
  if (hud?.mcp && hud.mcp.length > 0) {
    const mcpDisplay = hud.mcp.slice(0, 3).map((server) => {
      const icon = server.status === 'running' ? c.green('\u25CF') : server.status === 'error' ? c.red('\u25CF') : c.dim('\u25CB')
      return `${icon} ${c.cyan(server.name)}${server.tools !== undefined ? c.dim(`(${server.tools})`) : ''}`
    }).join(c.dim(' · '))
    extLines.push(mcpDisplay)
  }

  // Memory
  if (hud?.memory) {
    const used = hud.memory.usedMb !== undefined ? `${Math.round(hud.memory.usedMb)}MB` : ''
    const pct = hud.memory.percent !== undefined ? `${hud.memory.percent}%` : ''
    extLines.push(`${c.dim('Mem')} ${used} ${pct}`.trim())
  }

  // Brain
  if (hud?.brain) {
    const pct = hud.brain.usedPercent ?? 0
    const pctColor = pct >= 80 ? c.red : pct >= 60 ? c.yellow : c.green
    extLines.push(`${c.dim('Brain')} ${pctColor(String(pct))}%`)
  }

  // Hooks
  if (hud?.hooks) {
    extLines.push(`${c.dim('Hooks')} ${c.green(String(hud.hooks.active ?? 0))}/${hud.hooks.total ?? '?'}`)
  }

  // CVE
  if (hud?.cve) {
    const scanned = hud.cve.scanned ?? 0
    const vulns = hud.cve.vulnerabilities ?? 0
    const cveColor = vulns === 0 ? c.green : c.red
    extLines.push(`${cveColor('\u25CF')} ${scanned}/${vulns} ${c.dim('CVE')}`)
  }

  // Render compact extended lines (2-3 modules per line)
  for (let i = 0; i < extLines.length; i += 3) {
    const chunk = extLines.slice(i, i + 3)
    lines.push(c.dim('\u2502 ') + chunk.join(c.dim(' · ')))
  }

  // Footer separator
  if (lines.length > 1) {
    lines.push(c.dim('\u2570'))
  }

  return lines.join('\n')
}
