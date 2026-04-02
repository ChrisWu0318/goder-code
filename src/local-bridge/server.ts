/**
 * Goder Code Local Bridge Server
 *
 * iPhone → WebSocket → local bridge → goder --continue subprocess (stream-json)
 *
 * Each WebSocket connection gets one long-running subprocess that uses
 * `--continue` for multi-turn conversation. Messages are sent via stdin
 * as stream-json lines; responses stream back via stdout.
 *
 * Environment:
 *   GODER_BRIDGE_PORT  — port (default 7890)
 *   GODER_BRIDGE_TOKEN — auth token (auto-generated if unset)
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { readFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { networkInterfaces } from 'node:os'
import { WebSocketServer, type WebSocket } from 'ws'

type OutboundMsg = Record<string, unknown>

/** One persistent session per browser tab */
type Session = {
  id: string
  ws: WebSocket
  proc: ChildProcess
  busy: boolean  // true while a task is running
}

let httpServer: ReturnType<typeof createServer> | null = null
let wss: WebSocketServer | null = null
const sessions = new Map<string, Session>()
let authToken = ''
let bridgePort = 7890

// ---- Helpers ----

function localIP(): string | null {
  for (const nets of Object.values(networkInterfaces())) {
    for (const net of nets ?? []) {
      if (net.family === 'IPv4' && !net.internal) return net.address
    }
  }
  return null
}

function goderCmd(): string {
  // __dirname is src/local-bridge/ — go up 2 levels to project root
  const projectRoot = resolve(__dirname, '..', '..')
  const dist = join(projectRoot, 'dist', 'cli.js')
  if (existsSync(dist)) return dist
  return join(projectRoot, 'src', 'entrypoints', 'cli.tsx')
}

function send(ws: WebSocket, msg: OutboundMsg): void {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg))
}

// ---- Web UI ----

function serveUI(res: ServerResponse): void {
  const htmlPath = join(__dirname, 'web', 'index.html')
  if (existsSync(htmlPath)) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(readFileSync(htmlPath))
  } else {
    res.writeHead(404)
    res.end('Web UI not found')
  }
}

// ---- Session lifecycle ----

function createSession(ws: WebSocket): Session {
  const id = randomBytes(4).toString('hex')
  const cmd = goderCmd()
  const args = ['run', cmd, '-p', '--verbose', '--input-format', 'stream-json', '--output-format', 'stream-json', '--dangerously-skip-permissions']

  const proc: ChildProcess = spawn('bun', args,
    {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        CLAUDE_CODE_SIMPLE: '1',
        TERM: 'dumb',
      },
    },
  )

  const session: Session = { id, ws, proc, busy: false }

  // Parse stream-json output lines
  let buf = ''
  proc.stdout!.setEncoding('utf8')
  proc.stdout!.on('data', (chunk: string) => {
    buf += chunk
    const lines = buf.split('\n')
    buf = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const msg = JSON.parse(line)
        handleStreamMsg(session, msg)
      } catch {
        // Plain text output (shouldn't happen in stream-json mode, but be safe)
        send(ws, { type: 'assistant', text: line, sessionId: id })
      }
    }
  })

  // Drain stderr for debugging
  proc.stderr!.setEncoding('utf8')
  proc.stderr!.on('data', (chunk: string) => {
    const text = chunk.trim()
    if (text && !text.includes('Bun v') && !text.includes('Loaded')) {
      send(ws, { type: 'info', message: text, sessionId: id })
    }
  })

  proc.on('exit', () => {
    send(ws, { type: 'info', message: 'Session ended', sessionId: id })
    sessions.delete(id)
  })

  proc.on('error', (err) => {
    send(ws, { type: 'error', message: `Process error: ${err.message}`, sessionId: id })
    sessions.delete(id)
  })

  sessions.set(id, session)
  return session
}

function sendTask(session: Session, text: string): void {
  if (session.busy) {
    send(session.ws, { type: 'error', message: 'Previous task still running', sessionId: session.id })
    return
  }

  session.busy = true

  // stream-json input: type must be 'user' to match structuredIO.ts parsing
  const input = JSON.stringify({
    type: 'user',
    message: { role: 'user', content: text },
  })

  session.proc.stdin!.write(input + '\n')
}

function handleStreamMsg(session: Session, raw: Record<string, unknown>): void {
  const { ws, id } = session

  if (raw.type === 'assistant') {
    const msg = raw.message as Record<string, unknown> | undefined
    const content = msg?.content as Array<Record<string, unknown>> | undefined
    if (content) {
      for (const block of content) {
        if (block.type === 'text') {
          send(ws, { type: 'assistant', text: block.text, sessionId: id })
        } else if (block.type === 'tool_use') {
          send(ws, {
            type: 'tool_use',
            name: block.name,
            input: block.input ?? {},
            sessionId: id,
          })
        }
      }
    }
    return
  }

  if (raw.type === 'result') {
    session.busy = false
    send(ws, { type: 'done', sessionId: id })
    return
  }

  // system/init messages — skip unless interesting
  if (raw.type === 'system') return

  // Everything else as debug info
  send(ws, { type: 'info', message: JSON.stringify(raw), sessionId: id })
}

function killSession(session: Session): void {
  if (session.proc && !session.proc.killed) {
    session.proc.stdin?.end()
    session.proc.kill('SIGTERM')
  }
  sessions.delete(session.id)
}

// ---- HTTP handler ----

function handleRequest(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? '', `http://${req.headers.host}`)

  if (url.pathname === '/' || url.pathname === '/index.html') {
    serveUI(res)
    return
  }
  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ status: 'ok', sessions: sessions.size }))
    return
  }
  res.writeHead(404)
  res.end('Not Found')
}

// ---- WebSocket handler ----

function handleWS(ws: WebSocket, req: IncomingMessage): void {
  // Auth check
  if (authToken) {
    const url = new URL(req.url ?? '', `http://${req.headers.host}`)
    if (url.searchParams.get('token') !== authToken) {
      ws.close(4001, 'Unauthorized')
      return
    }
  }

  // Create a persistent session for this connection
  let session = createSession(ws)
  send(ws, { type: 'info', message: `Connected (session ${session.id})` })

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString())
      if (msg.type === 'task' && msg.text?.trim()) {
        sendTask(session, msg.text)
      } else if (msg.type === 'abort') {
        // Kill and restart the subprocess for a clean slate
        killSession(session)
        session = createSession(ws)
        send(ws, { type: 'info', message: `Session reset (${session.id})` })
      } else if (msg.type === 'ping') {
        send(ws, { type: 'pong' })
      }
    } catch {
      send(ws, { type: 'error', message: 'Invalid JSON' })
    }
  })

  ws.on('close', () => {
    killSession(session)
  })
}

// ---- Public API ----

export function startBridgeServer(
  port?: number,
): Promise<{ port: number; token: string; urls: string[] }> {
  return new Promise((resolve, reject) => {
    if (httpServer) return reject(new Error('Already running'))

    bridgePort = port ?? parseInt(process.env.GODER_BRIDGE_PORT ?? '7890', 10)
    authToken = process.env.GODER_BRIDGE_TOKEN ?? randomBytes(16).toString('hex')

    httpServer = createServer(handleRequest)
    wss = new WebSocketServer({ server: httpServer })
    wss.on('connection', handleWS)

    httpServer.listen(bridgePort, '0.0.0.0', () => {
      const ip = localIP()
      const urls = [`http://localhost:${bridgePort}`]
      if (ip) urls.push(`http://${ip}:${bridgePort}`)
      resolve({ port: bridgePort, token: authToken, urls })
    })

    httpServer.on('error', reject)
  })
}

export function stopBridgeServer(): Promise<void> {
  return new Promise((resolve) => {
    for (const s of sessions.values()) killSession(s)
    wss?.close()
    wss = null
    httpServer?.close(() => {
      httpServer = null
      resolve()
    })
    if (!httpServer) resolve()
  })
}

export function getBridgeStatus(): {
  running: boolean
  port: number
  activeSessions: number
} {
  return {
    running: httpServer !== null,
    port: bridgePort,
    activeSessions: sessions.size,
  }
}
