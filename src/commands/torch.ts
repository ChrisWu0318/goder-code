import type { Command } from '../types/command.js'
import type { ContentBlockParam, ToolUseContext } from '@anthropic-ai/sdk/resources/messages.js'

const torch: Command = {
  type: 'prompt',
  name: 'torch',
  description: 'Ignite a focused coding session with a clear task and goal',
  progressMessage: 'lighting the torch',
  contentLength: 0,
  source: 'builtin',
  async getPromptForCommand(args: string, context: ToolUseContext): Promise<ContentBlockParam[]> {
    return [{
      type: 'text',
      text: `You are in focused "torch" mode — a high-intensity coding session.

Args: ${args}

1. Clarify with the user what task or goal they want to focus on
2. Break down the task into clear, executable steps
3. Execute each step methodically, verifying results as you go
4. Report progress after each step and confirm completion

Stay focused on the task. Avoid tangents. Deliver results.`,
    }]
  },
}

export default torch
