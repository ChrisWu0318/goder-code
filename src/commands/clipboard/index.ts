import type { Command } from '../../commands.js'

const clipboard = {
  name: 'clipboard',
  description:
    'Grab images from the macOS clipboard (watch: -w, batch: --count N, watch timeout: --timeout SECS, watch limit: --max N)',
  supportsNonInteractive: false,
  type: 'local',
  load: () => import('./clipboard.js'),
} satisfies Command

export default clipboard
