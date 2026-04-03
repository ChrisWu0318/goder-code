import type { Command } from '../../commands.js'

const preview = {
  type: 'local',
  name: 'preview',
  description: 'Preview file content (PDF, DOCX, images) in the terminal',
  isEnabled: () => true,
  supportsNonInteractive: true,
  load: () => import('./preview.js'),
} satisfies Command

export default preview
