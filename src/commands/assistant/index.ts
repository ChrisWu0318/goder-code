import type { Command } from '../../types/command.js'
import { feature } from 'bun:bundle'

const assistant = {
  type: 'local-jsx',
  name: 'assistant',
  description: 'Show assistant setup wizard',
  isEnabled: () => feature('KAIROS'),
  load: () => import('./assistant.js'),
} satisfies Command

export default assistant
