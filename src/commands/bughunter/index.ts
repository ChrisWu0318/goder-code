import type { Command } from '../../types/command.js'
import type { ContentBlockParam, ToolUseContext } from '@anthropic-ai/sdk/resources/messages.js'

const bughunter: Command = {
  type: 'prompt',
  name: 'bughunter',
  description: 'Find and reproduce bugs in the current branch',
  progressMessage: 'hunting for bugs',
  contentLength: 0,
  source: 'builtin',
  async getPromptForCommand(args: string, context: ToolUseContext): Promise<ContentBlockParam[]> {
    return [{
      type: 'text',
      text: `You are a systematic bug hunter. Your job is to find bugs in the code on the current branch.

Args: ${args}

Steps:
1. Run \`git diff origin/HEAD...\` or \`git diff HEAD~3\` to see recent changes
2. Read the changed files carefully to understand what they do
3. Look for common bug patterns:
   - Off-by-one errors and boundary conditions
   - Unhandled null/undefined cases
   - Incorrect error handling or missing error propagation
   - State management issues (stale closures, race conditions)
   - Type mismatches and incorrect assumptions
   - Resource leaks (unclosed files, uncanceled timers)
   - Logic errors in conditionals
4. For each potential bug you find, try to write a minimal reproduction or explain the exact scenario
5. Report your findings with file paths, line numbers, and a clear description of the bug

Be thorough but focus on real bugs, not style issues.`,
    }]
  },
}

export default bughunter
