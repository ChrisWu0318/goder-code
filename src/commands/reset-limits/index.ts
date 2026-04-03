import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages.js'
import type { Command } from '../../types/command.js'

const resetLimits: Command = {
  type: 'prompt',
  name: 'reset-limits',
  description: 'Reset rate limits and usage tracking',
  progressMessage: 'resetting limits',
  contentLength: 0,
  source: 'builtin',
  async getPromptForCommand(): Promise<ContentBlockParam[]> {
    return [{
      type: 'text',
      text: 'Reset the rate limits and usage tracking for this session. Clear any cached rate limit state and allow fresh API requests.',
    }]
  },
}

const resetLimitsNonInteractive: Command = {
  ...resetLimits,
  type: 'prompt',
}

export { resetLimits, resetLimitsNonInteractive }
export default resetLimits
