import chalk from 'chalk'
import { spawn, spawnSync } from 'child_process'
import { readdir, readFile, unlink } from 'fs/promises'
import { join } from 'path'
import { getClaudeConfigHomeDir } from '../utils/envUtils.js'
import { isProcessRunning } from '../utils/genericProcessUtils.js'
import { jsonParse } from '../utils/slowOperations.js'

// ---------- Types ----------

type SessionInfo = {
  pid: number
  sessionId: string
  cwd: string
  startedAt: number
  kind: 'interactive' | 'bg' | 'daemon' | 'daemon-worker'
  name?: string
  logPath?: string
  agent?: string
  entrypoint?: string
  status?: 'busy' | 'idle' | 'waiting'
  waitingFor?: string
  updatedAt?: number
}

// ---------- Helpers ----------

function getSessionsDir(): string {
  return join(getClaudeConfigHomeDir(), 'sessions')
}

async function listLiveSessions(): Promise<SessionInfo[]> {
  const dir = getSessionsDir()
  let files: string[]
  try {
    files = await readdir(dir)
  } catch {
    return []
  }

  const sessions: SessionInfo[] = []
  for (const file of files) {
    if (!/^\d+\.json$/.test(file)) continue
    const pid = parseInt(file.slice(0, -5), 10)
    if (!isProcessRunning(pid)) {
      // Sweep stale PID file
      void unlink(join(dir, file)).catch(() => {})
      continue
    }
    try {
      const raw = await readFile(join(dir, file), 'utf8')
      const info = jsonParse(raw) as SessionInfo
      sessions.push(info)
    } catch {
      // Corrupted PID file, skip
    }
  }

  return sessions.sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))
}

function findSession(
  sessions: SessionInfo[],
  idOrName: string | undefined,
): SessionInfo | undefined {
  if (!idOrName) return undefined
  return sessions.find(
    s =>
      s.sessionId === idOrName ||
      s.sessionId.startsWith(idOrName) ||
      s.name === idOrName ||
      String(s.pid) === idOrName,
  )
}

function formatDuration(ms: number): string {
  const sec = Math.floor(ms / 1000)
  if (sec < 60) return `${sec}s`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ${sec % 60}s`
  const hr = Math.floor(min / 60)
  return `${hr}h ${min % 60}m`
}

function statusBadge(s: SessionInfo): string {
  const st = s.status ?? (s.kind === 'bg' ? 'busy' : 'idle')
  switch (st) {
    case 'busy':
      return chalk.green('● busy')
    case 'idle':
      return chalk.yellow('○ idle')
    case 'waiting':
      return chalk.magenta(`◎ waiting${s.waitingFor ? ` (${s.waitingFor})` : ''}`)
    default:
      return chalk.dim(st)
  }
}

// ---------- Handlers ----------

/**
 * `claude ps` — list all live sessions
 */
export async function psHandler(_args: string[]): Promise<void> {
  const sessions = await listLiveSessions()

  if (sessions.length === 0) {
    console.log(chalk.dim('No active sessions.'))
    return
  }

  console.log(
    chalk.bold(`  ${'PID'.padEnd(8)} ${'ID'.padEnd(10)} ${'KIND'.padEnd(13)} ${'STATUS'.padEnd(22)} ${'AGE'.padEnd(8)} NAME / CWD`),
  )
  console.log(chalk.dim('  ' + '─'.repeat(90)))

  for (const s of sessions) {
    const age = formatDuration(Date.now() - (s.startedAt ?? Date.now()))
    const label = s.name ?? s.cwd
    const shortId = (s.sessionId ?? '').slice(0, 8)
    const kind =
      s.kind === 'bg'
        ? chalk.cyan('bg')
        : s.kind === 'daemon'
          ? chalk.blue('daemon')
          : s.kind === 'daemon-worker'
            ? chalk.blue('worker')
            : chalk.dim('interactive')

    console.log(
      `  ${String(s.pid).padEnd(8)} ${shortId.padEnd(10)} ${kind.padEnd(13)} ${statusBadge(s).padEnd(22)} ${age.padEnd(8)} ${chalk.white(label)}`,
    )
  }
  console.log()
}

/**
 * `claude logs [sessionId]` — show transcript of a session
 */
export async function logsHandler(
  sessionId: string | undefined,
): Promise<void> {
  const sessions = await listLiveSessions()

  // If no id given, show bg sessions and hint
  if (!sessionId) {
    const bgSessions = sessions.filter(s => s.kind === 'bg')
    if (bgSessions.length === 0) {
      console.log(chalk.dim('No background sessions running.'))
      return
    }
    console.log(chalk.bold('Background sessions:'))
    for (const s of bgSessions) {
      const shortId = (s.sessionId ?? '').slice(0, 8)
      console.log(
        `  ${chalk.cyan(shortId)} ${statusBadge(s)}  ${s.name ?? s.cwd}`,
      )
    }
    console.log(chalk.dim('\nUsage: claude logs <session-id>'))
    return
  }

  const session = findSession(sessions, sessionId)
  if (!session) {
    console.error(chalk.red(`Session not found: ${sessionId}`))
    console.error(chalk.dim('Run `claude ps` to see active sessions.'))
    process.exitCode = 1
    return
  }

  // Read the transcript JSONL
  const { getProjectDir } = await import('../utils/sessionStorage.js')
  const projectDir = getProjectDir(session.cwd)
  const transcriptPath = join(projectDir, `${session.sessionId}.jsonl`)

  let content: string
  try {
    content = await readFile(transcriptPath, 'utf8')
  } catch {
    console.log(chalk.dim('No transcript found yet for this session.'))
    return
  }

  const lines = content.trim().split('\n')
  // Show last 50 entries by default
  const tail = lines.slice(-50)

  console.log(
    chalk.bold(
      `Transcript for ${session.name ?? session.sessionId.slice(0, 8)} (last ${tail.length} entries):\n`,
    ),
  )

  for (const line of tail) {
    try {
      const entry = JSON.parse(line) as {
        type?: string
        message?: { role?: string; content?: unknown }
      }
      const msg = entry.message
      if (!msg) continue

      const role = msg.role ?? entry.type ?? '?'
      let text = ''
      if (typeof msg.content === 'string') {
        text = msg.content.slice(0, 200)
      } else if (Array.isArray(msg.content)) {
        const textBlock = msg.content.find(
          (b: { type?: string }) => b.type === 'text',
        ) as { text?: string } | undefined
        text = textBlock?.text?.slice(0, 200) ?? ''
      }
      if (!text) continue

      const prefix =
        role === 'user'
          ? chalk.green('▸ user')
          : role === 'assistant'
            ? chalk.blue('▸ assistant')
            : chalk.dim(`▸ ${role}`)

      console.log(`${prefix}: ${text}${text.length >= 200 ? '…' : ''}`)
    } catch {
      // Skip malformed lines
    }
  }
  console.log()
}

/**
 * `claude attach [sessionId]` — re-attach to a bg tmux session
 */
export async function attachHandler(
  sessionId: string | undefined,
): Promise<void> {
  const sessions = await listLiveSessions()
  const bgSessions = sessions.filter(s => s.kind === 'bg')

  if (bgSessions.length === 0) {
    console.log(chalk.dim('No background sessions to attach to.'))
    return
  }

  let target: SessionInfo | undefined
  if (sessionId) {
    target = findSession(bgSessions, sessionId)
    if (!target) {
      console.error(chalk.red(`Background session not found: ${sessionId}`))
      process.exitCode = 1
      return
    }
  } else if (bgSessions.length === 1) {
    target = bgSessions[0]
  } else {
    console.log(chalk.bold('Multiple background sessions — specify one:'))
    for (const s of bgSessions) {
      const shortId = (s.sessionId ?? '').slice(0, 8)
      console.log(
        `  ${chalk.cyan(shortId)}  ${statusBadge(s)}  ${s.name ?? s.cwd}`,
      )
    }
    console.log(chalk.dim('\nUsage: claude attach <session-id>'))
    return
  }

  // Attach to the tmux session for this bg process
  const socketName = `claude-${target.pid}`
  console.log(
    chalk.dim(`Attaching to session ${target.name ?? target.sessionId.slice(0, 8)} (tmux socket: ${socketName})...`),
  )

  const result = spawnSync('tmux', ['-L', socketName, 'attach-session'], {
    stdio: 'inherit',
  })

  if (result.status !== 0) {
    // Fallback: try --resume instead
    console.log(
      chalk.yellow(
        'tmux attach failed — the session may not have a tmux pane.',
      ),
    )
    console.log(
      chalk.dim(
        `Try: claude --resume ${target.sessionId.slice(0, 8)}`,
      ),
    )
  }
}

/**
 * `claude kill [sessionId]` — terminate a session
 */
export async function killHandler(
  sessionId: string | undefined,
): Promise<void> {
  const sessions = await listLiveSessions()

  if (!sessionId) {
    const bgSessions = sessions.filter(s => s.kind === 'bg')
    if (bgSessions.length === 0) {
      console.log(chalk.dim('No background sessions to kill.'))
      return
    }
    console.log(chalk.bold('Active background sessions:'))
    for (const s of bgSessions) {
      const shortId = (s.sessionId ?? '').slice(0, 8)
      console.log(
        `  ${chalk.cyan(shortId)}  PID ${s.pid}  ${s.name ?? s.cwd}`,
      )
    }
    console.log(chalk.dim('\nUsage: claude kill <session-id|pid>'))
    return
  }

  const target = findSession(sessions, sessionId)
  if (!target) {
    console.error(chalk.red(`Session not found: ${sessionId}`))
    process.exitCode = 1
    return
  }

  // Gracefully kill the process
  try {
    process.kill(target.pid, 'SIGTERM')
    console.log(
      chalk.green(
        `Sent SIGTERM to session ${target.name ?? target.sessionId.slice(0, 8)} (PID ${target.pid})`,
      ),
    )

    // Also kill its tmux server if it was a bg session
    if (target.kind === 'bg') {
      const socketName = `claude-${target.pid}`
      spawnSync('tmux', ['-L', socketName, 'kill-server'], {
        stdio: 'ignore',
      })
    }

    // Clean up PID file
    const pidFile = join(getSessionsDir(), `${target.pid}.json`)
    await unlink(pidFile).catch(() => {})
  } catch (e) {
    console.error(
      chalk.red(`Failed to kill PID ${target.pid}: ${(e as Error).message}`),
    )
    process.exitCode = 1
  }
}

/**
 * `claude --bg "prompt"` or `claude --background "prompt"` — spawn a background session
 */
export async function handleBgFlag(args: string[]): Promise<void> {
  // Strip --bg / --background from args
  const cleanArgs = args.filter(a => a !== '--bg' && a !== '--background')

  // Extract the prompt (everything that isn't a flag)
  const promptParts: string[] = []
  const passthrough: string[] = []
  for (const arg of cleanArgs) {
    if (arg.startsWith('-')) {
      passthrough.push(arg)
    } else {
      promptParts.push(arg)
    }
  }
  const prompt = promptParts.join(' ')
  if (!prompt) {
    console.error(chalk.red('Usage: claude --bg "your prompt here"'))
    process.exitCode = 1
    return
  }

  // Generate a session name from prompt (first 30 chars)
  const name = prompt.slice(0, 30).replace(/[^a-zA-Z0-9_\- ]/g, '').trim()

  // Find the entry script path
  const entryScript = process.argv[1]

  // Build child args: run in pipe mode with the prompt
  const childArgs = [entryScript, '-p', ...passthrough, prompt]

  console.log(chalk.dim(`Starting background session: ${name}`))

  // Spawn a detached child process
  const child = spawn(process.execPath, childArgs, {
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      CLAUDE_CODE_SESSION_KIND: 'bg',
      CLAUDE_CODE_SESSION_NAME: name,
      CLAUDE_CODE_ENTRYPOINT: 'bg',
    },
  })

  child.unref()

  // Collect a bit of stdout for initial feedback
  let output = ''
  child.stdout?.on('data', (data: Buffer) => {
    output += data.toString()
  })
  child.stderr?.on('data', (data: Buffer) => {
    output += data.toString()
  })

  // Give it a moment to register
  await new Promise(resolve => setTimeout(resolve, 500))

  console.log(
    chalk.green(`Background session started (PID ${child.pid})`),
  )
  console.log(chalk.dim('  claude ps       — view sessions'))
  console.log(chalk.dim('  claude logs     — view output'))
  console.log(chalk.dim('  claude kill     — stop session'))
}
