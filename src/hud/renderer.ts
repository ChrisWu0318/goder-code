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

  // ---- Line 1: [Model] | project git:(branch*) | duration ----
  const line1Parts: string[] = []

  // Model
  const modelName = input.model?.display_name || input.model?.id || 'Unknown'
  line1Parts.push(c.cyan(`[${modelName}]`))

  // Active project (if any, otherwise directory name)
  if (input.active_project) {
    line1Parts.push(c.green(`project:${input.active_project.name}`))
  } else {
    const segments = cwd.split(/[/\\]/).filter(Boolean)
    if (segments.length > 0) {
      const projectPath = segments.slice(-2).join('/')
      line1Parts.push(c.yellow(projectPath))
    }
  }

  // Git status
  const git = await getGitStatus(cwd)
  if (git) {
    const dirty = git.isDirty ? '*' : ''
    const aheadBehind =
      (git.ahead > 0 ? ` \u2191${git.ahead}` : '') +
      (git.behind > 0 ? ` \u2193${git.behind}` : '')
    line1Parts.push(
      `${c.magenta('git:(')}${c.cyan(git.branch + dirty + aheadBehind)}${c.magenta(')')}`,
    )
  }

  // Session duration
  if (input.cost?.total_duration_ms) {
    line1Parts.push(c.dim(`\u23F1\uFE0F  ${formatDuration(input.cost.total_duration_ms)}`))
  }

  // Version
  if (input.version) {
    line1Parts.push(c.dim(`v${input.version}`))
  }

  lines.push(line1Parts.join(' \u2502 '))

  // ---- Line 2: Context bar | Usage bar ----
  const line2Parts: string[] = []

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
    contextPercent = Math.min(
      100,
      Math.round((totalTokens / ctxWindow.context_window_size) * 100),
    )
  }

  const ctxColor = getContextColor(contextPercent)
  let contextDisplay = `${c.dim('Context')} ${coloredBar(contextPercent, 10)} ${ctxColor}${contextPercent}%${RESET}`

  // Token breakdown when > 85%
  if (contextPercent >= 85 && ctxWindow?.current_usage) {
    const inp = formatTokens(ctxWindow.current_usage.input_tokens ?? 0)
    const cache = formatTokens(
      (ctxWindow.current_usage.cache_creation_input_tokens ?? 0) +
        (ctxWindow.current_usage.cache_read_input_tokens ?? 0),
    )
    contextDisplay += c.dim(` (in: ${inp}, cache: ${cache})`)
  }
  line2Parts.push(contextDisplay)

  // Usage (rate limits)
  const fiveHour = input.rate_limits?.five_hour?.used_percentage
  const sevenDay = input.rate_limits?.seven_day?.used_percentage
  if (typeof fiveHour === 'number') {
    const fhColor = getQuotaColor(fiveHour)
    const resetAt = input.rate_limits?.five_hour?.resets_at
    const resetStr = resetAt ? ` (resets in ${formatResetTime(resetAt)})` : ''
    line2Parts.push(
      `${c.dim('Usage')} ${quotaBar(fiveHour, 10)} ${fhColor}${Math.round(fiveHour)}%${RESET}${c.dim(resetStr)}`,
    )
  }
  if (typeof sevenDay === 'number' && sevenDay >= 50) {
    const sdColor = getQuotaColor(sevenDay)
    const resetAt = input.rate_limits?.seven_day?.resets_at
    const resetStr = resetAt ? ` (resets in ${formatResetTime(resetAt)})` : ''
    line2Parts.push(
      `${c.dim('7d:')} ${sdColor}${Math.round(sevenDay)}%${RESET}${c.dim(resetStr)}`,
    )
  }

  lines.push(line2Parts.join(' \u2502 '))

  // ---- Line 3: Tools (from transcript) ----
  const transcriptPath = input.transcript_path || ''
  const transcript = parseTranscriptSync(transcriptPath)

  if (transcript.tools.length > 0) {
    const toolParts: string[] = []
    const running = transcript.tools.filter((t) => t.status === 'running')
    for (const tool of running.slice(-2)) {
      const target = tool.target
        ? tool.target.length > 20
          ? '.../' + tool.target.split('/').pop()
          : tool.target
        : ''
      toolParts.push(
        `${c.yellow('\u25D0')} ${c.cyan(tool.name)}${target ? c.dim(`: ${target}`) : ''}`,
      )
    }
    if (toolParts.length > 0) {
      lines.push(toolParts.join(' | '))
    }
  }

  // ---- Line 4: Agents (from transcript) ----
  const runningAgents = transcript.agents.filter((a) => a.status === 'running')
  const recentCompleted = transcript.agents
    .filter((a) => a.status === 'completed')
    .slice(-2)
  const agentsToShow = [...runningAgents, ...recentCompleted].slice(-3)

  for (const agent of agentsToShow) {
    const icon =
      agent.status === 'running' ? c.yellow('\u25D0') : c.green('\u2713')
    const type = c.magenta(agent.type)
    const model = agent.model ? c.dim(`[${agent.model}]`) : ''
    const desc = agent.description
      ? c.dim(
          `: ${agent.description.length > 40 ? agent.description.slice(0, 37) + '...' : agent.description}`,
        )
      : ''
    const elapsed = c.dim(`(${formatElapsed(agent.startMs, agent.endMs)})`)
    lines.push(`${icon} ${type}${model ? ` ${model}` : ''}${desc} ${elapsed}`)
  }

  // ---- Extended HUD: Brand/User line (like RuFlo V3.5 ● Chris Wu) ----
  const hud = input.hud
  if (hud) {
    const brand = hud.brand || 'Goder'
    const user = hud.user ? ` ● ${hud.user}` : ''
    lines.unshift(`${c.cyan('\u25A9')} ${c.green(brand)}${user}`)
  }

  // ---- Extended HUD: MCP Servers ----
  if (hud?.mcp && hud.mcp.length > 0) {
    const mcpParts: string[] = []
    for (const server of hud.mcp.slice(0, 3)) {
      const icon = server.status === 'running' ? c.green('\u25CF') : server.status === 'error' ? c.red('\u25CF') : c.dim('\u25CB')
      const tools = server.tools !== undefined ? c.dim(`(${server.tools})`) : ''
      mcpParts.push(`${icon} ${c.cyan(server.name)}${tools}`)
    }
    lines.push(`${c.dim('MCP')} ${mcpParts.join(' ')}`)
  }

  // ---- Extended HUD: Swarm Status ----
  if (hud?.swarm) {
    const swarmIcon = hud.swarm.active ? c.green('\u25B6') : c.dim('\u25B6')
    const agents = hud.swarm.agents !== undefined ? ` ${c.yellow(String(hud.swarm.agents))}` : ''
    const max = hud.swarm.maxAgents !== undefined ? c.dim(`/ ${hud.swarm.maxAgents}`) : ''
    lines.push(`${swarmIcon}${c.dim(' Swarm')} ${agents}${max}`)
  }

  // ---- Extended HUD: DDD Domains ----
  if (hud?.ddd) {
    const total = hud.ddd.total || 0
    const completed = hud.ddd.completed || 0
    const domains = hud.ddd.domains || []
    const domainStr = domains.length > 0 ? ` ${domains.slice(0, 3).join(', ')}` : ''
    lines.push(`${c.dim('DDD')} ${domainStr} ${c.green('[')}${completed}/${total}${c.green(']')}`)
  }

  // ---- Extended HUD: Architecture Status ----
  if (hud?.architecture) {
    const adrPart = hud.architecture.adrCount !== undefined
      ? ` ADR ${c.cyan(String(hud.architecture.adrCount))}${hud.architecture.adrTotal !== undefined ? c.dim(`/ ${hud.architecture.adrTotal}`) : ''}`
      : ''
    const dddPart = hud.architecture.dddPercent !== undefined
      ? ` ${c.magenta('DDD')} ${hud.architecture.dddPercent}%`
      : ''
    const secStatus = hud.architecture.securityStatus
    const secIcon = secStatus === 'clear' ? c.green('\u2713') : secStatus === 'issue' ? c.red('\u2717') : secStatus === 'scanning' ? c.yellow('\u25D2') : c.dim('\u25CB')
    const secPart = secStatus ? ` ${secIcon} ${c.dim('Security')}` : ''
    lines.push(`${c.dim('Architecture')}${adrPart}${dddPart}${secPart}`)
  }

  // ---- Extended HUD: AgentDB Status ----
  if (hud?.agentdb) {
    const vectors = hud.agentdb.vectors !== undefined ? ` ${c.cyan('Vec')} ${hud.agentdb.vectors}` : ''
    const size = hud.agentdb.sizeKb !== undefined ? ` ${c.dim(String(Math.round(hud.agentdb.sizeKb / 1024)))}MB` : ''
    const tests = hud.agentdb.tests !== undefined ? ` ${c.green('Test')} ${hud.agentdb.tests}` : ''
    lines.push(`${c.dim('AgentDB')}${vectors}${size}${tests}`)
  }

  // ---- Extended HUD: Hooks Status ----
  if (hud?.hooks) {
    const active = hud.hooks.active ?? 0
    const total = hud.hooks.total ?? 0
    lines.push(`${c.dim('Hooks')} ${c.green(String(active))}/${total}`)
  }

  // ---- Extended HUD: CVE Status ----
  if (hud?.cve) {
    const scanned = hud.cve.scanned ?? 0
    const vulns = hud.cve.vulnerabilities ?? 0
    const cveIcon = vulns === 0 ? c.green('\u25CF') : c.red('\u25CF')
    lines.push(`${cveIcon} ${c.dim('CVE')} ${scanned}/${vulns}`)
  }

  // ---- Extended HUD: Memory Status ----
  if (hud?.memory) {
    const used = hud.memory.usedMb !== undefined ? ` ${c.yellow(String(Math.round(hud.memory.usedMb)))}MB` : ''
    const pct = hud.memory.percent !== undefined ? ` ${hud.memory.percent}%` : ''
    lines.push(`${c.dim('Memory')}${used}${pct ? c.cyan(pct) : ''}`)
  }

  // ---- Extended HUD: Brain Status ----
  if (hud?.brain) {
    const pct = hud.brain.usedPercent ?? 0
    const pctColor = pct >= 80 ? c.red : pct >= 60 ? c.yellow : c.green
    lines.push(`${c.dim('Brain')} ${pctColor(String(pct))}%`)
  }

  return lines.join('\n')
}
