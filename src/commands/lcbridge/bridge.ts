/**
 * /bridge command — start/stop the local WebSocket bridge for iPhone remote control.
 *
 *   /bridge           → start (or show status if running)
 *   /bridge stop      → stop
 *   /bridge status    → show info
 */

import type { LocalCommandCall } from '../../types/command.js'

export const call: LocalCommandCall = async (args) => {
  const cmd = args?.trim().toLowerCase() || ''

  // Lazy-load the server module (avoids importing ws/http at startup)
  const { getBridgeStatus, startBridgeServer, stopBridgeServer } = await import(
    '../../local-bridge/server.js'
  )

  const status = getBridgeStatus()

  if (cmd === 'stop') {
    if (!status.running) {
      return { type: 'text', value: 'Bridge is not running.' }
    }
    await stopBridgeServer()
    return { type: 'text', value: 'Bridge stopped.' }
  }

  if (cmd === 'status') {
    if (!status.running) {
      return { type: 'text', value: 'Bridge is not running. Use /bridge to start it.' }
    }
    return {
      type: 'text',
      value: `Bridge running on port ${status.port} (${status.activeSessions} session${status.activeSessions === 1 ? '' : 's'}).`,
    }
  }

  // Default: start (or show running info)
  if (status.running) {
    return {
      type: 'text',
      value: `Bridge already running on port ${status.port}. Use /bridge stop to stop it.`,
    }
  }

  try {
    const { port, token, urls } = await startBridgeServer()
    const lines = [
      `Bridge started on port ${port}`,
      '',
      'Connect from your iPhone:',
      ...urls.map((u: string) => `  ${u}?token=${token}`),
      '',
      `Token: ${token}`,
    ]
    return { type: 'text', value: lines.join('\n') }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { type: 'text', value: `Failed to start bridge: ${msg}` }
  }
}
