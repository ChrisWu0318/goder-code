import type { Command } from '../../types/command.js'
import type { ContentBlockParam, ToolUseContext } from '@anthropic-ai/sdk/resources/messages.js'

const share: Command = {
  type: 'prompt',
  name: 'share',
  description: 'Share the current session with a link or copy the transcript',
  progressMessage: 'preparing session share',
  contentLength: 0,
  source: 'builtin',
  async getPromptForCommand(args: string, context: ToolUseContext): Promise<ContentBlockParam[]> {
    return [{
      type: 'text',
      text: `Help the user share the current session.

Args: ${args}

1. Summarize the current conversation briefly
2. If the user wants to copy the transcript, provide the conversation content
3. If the user wants to save to a file, write a clean markdown summary
4. Keep the output clean and focused on the core content

Be concise and helpful.`,
    }]
  },
}

export default share
