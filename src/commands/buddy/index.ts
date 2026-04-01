import type { Command } from '../../types/command.js'

const buddy = {
  type: 'local-jsx',
  name: 'buddy',
  description: 'Hatch, view, or pet your companion',
  immediate: true,
  argumentHint: '[pet|mute|unmute|info]',
  load: () => import('./buddy.js'),
} satisfies Command

export default buddy
