import type { Command } from '../../types/command.js'
import type { ContentBlockParam, ToolUseContext } from '@anthropic-ai/sdk/resources/messages.js'

const teleport: Command = {
  type: 'prompt',
  name: 'teleport',
  description: 'Jump to a different part of the codebase or change context',
  progressMessage: 'teleporting to new context',
  contentLength: 0,
  source: 'builtin',
  async getPromptForCommand(args: string, context: ToolUseContext): Promise<ContentBlockParam[]> {
    return [{
      type: 'text',
      text: `The user wants to change context or jump to a different area of the codebase.

Args: ${args}

1. Based on what the user described, find and summarize the relevant files and code
2. Load the relevant context so the user can continue working from that new location
3. If no specific destination is clear, show the available project areas

Be concise and focused on helping the user switch context.`,
    }]
  },
}

export default teleport
