import type { Command } from '../../commands.js'
import { shouldInferenceConfigCommandBeImmediate } from '../../utils/immediateCommand.js'
import { isThinkingForced, toggleThinking } from '../../utils/thinkingToggle.js'

const thinking = {
  type: 'local-jsx',
  name: 'thinking',
  get description() {
    return `Toggle deep thinking mode (${isThinkingForced() ? 'ON' : 'OFF'} — ${isThinkingForced() ? 'forces reasoning before each response' : 'responses skip explicit reasoning'})`
  },
  argumentHint: '[on|off]',
  get immediate() {
    return shouldInferenceConfigCommandBeImmediate()
  },
  load: () => import('./thinking.js'),
} satisfies Command

export default thinking
