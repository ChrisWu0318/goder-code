import type { Command } from '../../commands.js'

const bridge = {
  type: 'local',
  name: 'bridge',
  description: 'Start local WebSocket bridge for iPhone remote control',
  argumentHint: '[stop|status]',
  supportsNonInteractive: false,
  load: () => import('./bridge.js'),
} satisfies Command

export default bridge
