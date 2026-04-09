/**
 * Goder Remote Bridge — IPC emitter
 *
 * When `GODER_REMOTE_BRIDGE` env var is set, this module connects to the
 * local bridge UNIX socket and emits structured events for the remote
 * client (iPhone/Watch) to render.
 *
 * It hooks into:
 *   1. Stream events (text output, thinking)
 *   2. Tool calls (start/end with name, title, args)
 *   3. Permission requests (await remote approval)
 *   4. Turn boundaries (turn-start/turn-end)
 *
 * This file is imported from the Goder main entry point.
 */

import { createConnection, type Socket } from 'net'

export type RemoteBridgeEventType =
  | 'text'
  | 'tool-start'
  | 'tool-end'
  | 'permission-request'
  | 'permission-response'
  | 'turn-start'
  | 'turn-end'
  | 'prompt-submitted'

interface RemoteBridgeEvent {
  t: RemoteBridgeEventType
  [key: string]: unknown
}

let bridgeSocket: Socket | null = null
let buffer: string[] = []
let connected = false

/**
 * Initialize the remote bridge emitter. Called from Goder's startup.
 * Connects to the bridge's UNIX socket if GODER_REMOTE_BRIDGE is set.
 */
export async function initRemoteBridge(): Promise<boolean> {
  const socketPath = process.env.GODER_REMOTE_BRIDGE
  if (!socketPath) return false

  // Check if it's a session ID (not a socket path)
  const homeSocket = `${process.env.HOME}/.claude/goder-remote.sock`
  const actualPath = socketPath.startsWith('/') ? socketPath : homeSocket

  return new Promise((resolve) => {
    try {
      bridgeSocket = createConnection(actualPath, () => {
        connected = true
        // Flush any buffered events
        for (const line of buffer) {
          bridgeSocket!.write(line + '\n')
        }
        buffer = []
        console.error(`[remote] connected to bridge at ${actualPath}`)
        resolve(true)
      })

      bridgeSocket.on('error', () => {
        console.error('[remote] failed to connect to bridge socket')
        bridgeSocket = null
        resolve(false)
      })

      bridgeSocket.on('close', () => {
        connected = false
        console.error('[remote] bridge socket disconnected')
      })

      // Handle remote input (user typing on iPhone)
      bridgeSocket.on('data', (chunk) => {
        console.error('[remote] received from relay:', chunk.toString().trim())
      })

      // Timeout after 2 seconds — don't block startup
      setTimeout(() => {
        if (!connected) {
          bridgeSocket?.destroy()
          resolve(false)
        }
      }, 2000)
    } catch {
      resolve(false)
    }
  })
}

/** Send a structured event to the bridge (buffered if not yet connected) */
export function emitRemoteEvent(event: RemoteBridgeEvent): void {
  const line = JSON.stringify(event)

  if (!connected) {
    buffer.push(line)
    if (buffer.length > 200) buffer.shift()  // bounded buffer
    return
  }

  if (bridgeSocket?.writable) {
    bridgeSocket.write(line + '\n')
  }
}

/** Emit a text chunk from the streaming response */
export function emitStreamingText(text: string, role: 'agent' | 'user' | 'system' = 'agent'): void {
  // Only send if there's actual visible content (skip ANSI escape sequences)
  if (!text.trim()) return
  emitRemoteEvent({ t: 'text', text, role })
}

/** Emit the start of a tool execution */
export function emitToolStart(tool: { name: string; input?: Record<string, unknown> }): void {
  const name = tool.name || 'unknown'
  const title = generateToolTitle(name, tool.input)
  const description = tool.input ? formatToolArgs(tool.input) : ''

  emitRemoteEvent({
    t: 'tool-start',
    call: `tool_${Date.now()}`,
    name,
    title,
    description,
    args: tool.input || {},
  })
}

/** Emit the completion of a tool */
export function emitToolEnd(call: string, success: boolean): void {
  emitRemoteEvent({ t: 'tool-end', call, ok: success })
}

/** Emit a permission request (blocks until remote responds) */
export async function requestRemotePermission(
  id: string,
  tool: string,
  title: string,
  description: string,
  args?: Record<string, unknown>,
): Promise<boolean> {
  return new Promise((resolve) => {
    emitRemoteEvent({
      t: 'permission-request',
      id,
      tool,
      title,
      description,
      args,
    })
    // In IPC mode the bridge resolves this via a callback mechanism.
    // For now, default to "denied" if remote is unreachable
    setTimeout(() => resolve(false), 30_000)
  })
}

/** Emit turn start */
export function emitTurnStart(): void {
  emitRemoteEvent({ t: 'turn-start' })
}

/** Emit turn end */
export function emitTurnEnd(status: 'completed' | 'failed' | 'cancelled' = 'completed'): void {
  emitRemoteEvent({ t: 'turn-end', status })
}

/** Emit prompt submitted event */
export function emitPromptSubmitted(text: string): void {
  emitRemoteEvent({ t: 'prompt-submitted', text })
}

// ── Helpers ──────────────────────────────────────────────

function generateToolTitle(name: string, input?: Record<string, unknown>): string {
  switch (name) {
    case 'Bash':
      return `Running \`${(input?.command as string)?.slice(0, 60) || 'command'}\``
    case 'Read':
      return `Reading file: ${formatPath(input?.file_path as string)}`
    case 'Write':
      return `Writing to: ${formatPath(input?.file_path as string)}`
    case 'Edit':
      return `Editing: ${formatPath(input?.file_path as string)}`
    case 'Grep':
      return `Searching: \`${input?.pattern as string}\``
    case 'Glob':
      return `Finding: \`${input?.pattern as string}\``
    case 'Agent':
      return `Using agent: ${input?.description as string || 'Task agent'}`
    default:
      return `Using ${name}`
  }
}

function formatToolArgs(args: Record<string, unknown>): string {
  const parts: string[] = []
  for (const [key, val] of Object.entries(args)) {
    if (key === 'command' || key === 'file_path' || key === 'pattern') {
      parts.push(`\`${String(val).slice(0, 80)}\``)
    }
  }
  return parts.join(' → ')
}

function formatPath(p?: string): string {
  if (!p) return 'unknown file'
  // Replace home dir with ~
  const home = process.env.HOME || ''
  if (p.startsWith(home)) return '~' + p.slice(home.length)
  return p
}
