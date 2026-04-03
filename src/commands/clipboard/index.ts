import type { Command } from '../../commands.js'

const clipboard = {
  name: 'clipboard',
  description:
    'Grab images from the macOS clipboard (watch mode: --watch, batch: --count N)',
  supportsNonInteractive: false,
  type: 'local',
  load: () => import('./clipboard.js'),
} satisfies Command

export default clipboard
