import type { Command } from '../../commands.js'

const command = {
  name: 'hud',
  description: 'Toggle the built-in HUD statusline (context, tools, agents)',
  supportsNonInteractive: false,
  type: 'local',
  load: () => import('./hud.js'),
} satisfies Command

export default command
