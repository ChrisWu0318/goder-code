import type { LocalCommandCall } from '../../types/command.js'
import { getGlobalConfig, saveGlobalConfig } from '../../utils/config.js'

export const call: LocalCommandCall = async () => {
  const config = getGlobalConfig()
  const wasEnabled = config.hudEnabled === true
  const newEnabled = !wasEnabled

  saveGlobalConfig(current => ({
    ...current,
    hudEnabled: newEnabled,
  }))

  if (newEnabled) {
    return {
      type: 'text',
      value:
        'HUD enabled. The statusline will show model, context, tools, and agents.\n' +
        'Run /hud again to disable.',
    }
  }

  return {
    type: 'text',
    value: 'HUD disabled.',
  }
}
