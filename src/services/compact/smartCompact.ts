/**
 * smartCompact — local-only conversation compaction that summarizes older turns
 * without making any API calls.
 *
 * Strategy (applied in order):
 *   Phase 1: Prune large tool results in older turns
 *   Phase 2: Group consecutive older turns into segments
 *   Phase 3: Summarize each segment into a single synthetic message
 *   Phase 4: Preserve the most recent N turns untouched
 */

import type { UUID } from 'crypto'
import type { Message, MessageContent } from '../../types/message.js'

// ---------------------------------------------------------------------------
// Token estimation
// ---------------------------------------------------------------------------

/**
 * Rough token count estimation. 1 token ~= 4 characters for English text,
 * which is the standard heuristic used by most tokeniser-free estimators.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Threshold (in characters) above which a tool result is considered "large". */
const LARGE_TOOL_RESULT_CHARS = 500

/** How many leading characters to keep when pruning a tool result. */
const TOOL_RESULT_PREVIEW_CHARS = 100

/** Default number of recent turns to preserve intact. */
const DEFAULT_PRESERVE_RECENT = 4

/**
 * Extract the plain-text representation of a message's content.
 * Handles both `string` content and the `ContentBlockParam[]` / `ContentBlock[]`
 * array form used throughout the codebase.
 */
function extractText(content: MessageContent | undefined): string {
  if (!content) return ''
  if (typeof content === 'string') return content

  const parts: string[] = []
  for (const block of content) {
    if ('text' in block && typeof block.text === 'string') {
      parts.push(block.text)
    } else if (block.type === 'tool_use' && 'name' in block) {
      parts.push(`[tool_use: ${(block as { name: string }).name}]`)
    } else if (block.type === 'tool_result') {
      const tr = block as { content?: string | { text?: string }[] }
      if (typeof tr.content === 'string') {
        parts.push(tr.content)
      } else if (Array.isArray(tr.content)) {
        for (const sub of tr.content) {
          if (typeof sub === 'object' && sub && 'text' in sub && typeof sub.text === 'string') {
            parts.push(sub.text)
          }
        }
      }
    }
  }
  return parts.join('\n')
}

/**
 * Produce a one-line human-readable summary for a single message.
 */
function summarizeMessage(msg: Message): string {
  const role = msg.message?.role ?? msg.type
  const text = extractText(msg.message?.content).trim()
  if (!text) return ''
  // Limit to first 200 chars to keep segment summaries concise
  const preview = text.length > 200 ? text.slice(0, 200) + '...' : text
  return `${role}: ${preview}`
}

/**
 * Detect tool_use block names present in a content array.
 */
function extractToolNames(content: MessageContent | undefined): string[] {
  if (!content || typeof content === 'string') return []
  const names: string[] = []
  for (const block of content) {
    if (block.type === 'tool_use' && 'name' in block) {
      names.push((block as { name: string }).name)
    }
  }
  return names
}

// ---------------------------------------------------------------------------
// Phase 1 — Tool result pruning
// ---------------------------------------------------------------------------

/**
 * Replace large tool_result content blocks in older messages with a short
 * preview string. Returns a new array (does not mutate originals).
 */
function pruneToolResults(
  messages: Message[],
  preserveFromIndex: number,
): { messages: Message[]; tokensFreed: number } {
  let tokensFreed = 0

  const result = messages.map((msg, idx) => {
    if (idx >= preserveFromIndex) return msg
    if (msg.type !== 'user' || !Array.isArray(msg.message?.content)) return msg

    let touched = false
    const newContent = (msg.message!.content as Array<Record<string, unknown>>).map((block) => {
      if (block.type !== 'tool_result') return block

      const raw = block as { type: string; content?: string | unknown[]; tool_use_id?: string }
      let text = ''
      if (typeof raw.content === 'string') {
        text = raw.content
      } else if (Array.isArray(raw.content)) {
        text = raw.content
          .map((c) => (typeof c === 'object' && c && 'text' in c ? (c as { text: string }).text : ''))
          .join('')
      }

      if (text.length <= LARGE_TOOL_RESULT_CHARS) return block

      const toolName = raw.tool_use_id ?? 'unknown'
      const preview = text.slice(0, TOOL_RESULT_PREVIEW_CHARS)
      const replacement = `[Tool result: ${toolName} — ${preview}...]`

      tokensFreed += estimateTokens(text) - estimateTokens(replacement)
      touched = true
      return { ...block, content: replacement }
    })

    if (!touched) return msg
    return {
      ...msg,
      message: { ...msg.message, content: newContent },
    } as Message
  })

  return { messages: result, tokensFreed }
}

// ---------------------------------------------------------------------------
// Phase 2 & 3 — Segment grouping and summarization
// ---------------------------------------------------------------------------

/** A contiguous run of messages that will be collapsed into a summary. */
interface Segment {
  messages: Message[]
  startIndex: number
  endIndex: number
}

/**
 * Group older messages into segments of roughly equal size.
 * Each segment is a consecutive range of messages.  We aim for segments
 * of ~6 messages so summaries stay informative but compact.
 */
function groupIntoSegments(messages: Message[], upToIndex: number): Segment[] {
  const TARGET_SEGMENT_SIZE = 6
  const segments: Segment[] = []
  let current: Message[] = []
  let startIdx = 0

  for (let i = 0; i < upToIndex; i++) {
    if (current.length === 0) startIdx = i
    current.push(messages[i]!)

    if (current.length >= TARGET_SEGMENT_SIZE) {
      segments.push({ messages: [...current], startIndex: startIdx, endIndex: i })
      current = []
    }
  }

  // Remaining messages form a final segment
  if (current.length > 0) {
    segments.push({
      messages: current,
      startIndex: startIdx,
      endIndex: startIdx + current.length - 1,
    })
  }

  return segments
}

/**
 * Build a synthetic summary message for a segment of conversation.
 * Extracts what the user asked, what the assistant did, and what tools
 * were invoked.
 */
function summarizeSegment(segment: Segment): Message {
  const userParts: string[] = []
  const assistantParts: string[] = []
  const toolsUsed = new Set<string>()

  for (const msg of segment.messages) {
    const line = summarizeMessage(msg)
    if (!line) continue

    if (msg.type === 'user') {
      userParts.push(line)
    } else if (msg.type === 'assistant') {
      assistantParts.push(line)
      for (const name of extractToolNames(msg.message?.content)) {
        toolsUsed.add(name)
      }
    }
    // system / attachment / progress messages are intentionally dropped
    // from the summary text — their effects are captured in assistant replies.
  }

  const userSummary = userParts.length > 0
    ? userParts.join('; ')
    : '(no user messages)'

  const assistantSummary = assistantParts.length > 0
    ? assistantParts.join('; ')
    : '(no assistant messages)'

  const toolList = toolsUsed.size > 0
    ? ` Tools used: ${[...toolsUsed].join(', ')}.`
    : ''

  const summaryText =
    `[Conversation summary: user asked ${userSummary}; ` +
    `assistant did ${assistantSummary}.${toolList}]`

  return {
    type: 'system',
    uuid: crypto.randomUUID() as UUID,
    isCompactSummary: true,
    message: {
      role: 'user',
      content: summaryText,
    },
  } as Message
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function smartCompactMessages(
  messages: Message[],
  options: {
    maxTokenEstimate: number
    preserveRecentTurns?: number
    preserveSystemMessages?: boolean
  },
): { messages: Message[]; summary: string; tokensFreed: number } {
  const preserveRecent = options.preserveRecentTurns ?? DEFAULT_PRESERVE_RECENT
  const preserveSystem = options.preserveSystemMessages ?? true

  // Determine the split point: everything before this index is eligible for compaction.
  const splitIndex = Math.max(0, messages.length - preserveRecent)

  if (splitIndex === 0) {
    // Nothing old enough to compact
    return { messages, summary: '', tokensFreed: 0 }
  }

  // Measure the starting token count
  const startingTokens = estimateTokens(
    messages.map((m) => extractText(m.message?.content)).join('\n'),
  )

  // --- Phase 1: Prune large tool results in older turns ---
  const phase1 = pruneToolResults(messages, splitIndex)
  let working = phase1.messages
  let totalFreed = phase1.tokensFreed

  // Check if we are already under the target after phase 1
  const tokensAfterPhase1 = startingTokens - totalFreed
  if (tokensAfterPhase1 <= options.maxTokenEstimate) {
    return {
      messages: working,
      summary: 'Phase 1 (tool result pruning) was sufficient.',
      tokensFreed: totalFreed,
    }
  }

  // --- Phase 2 & 3: Segment grouping and local summarization ---
  const olderMessages = working.slice(0, splitIndex)
  const recentMessages = working.slice(splitIndex)

  // Separate system messages that should be preserved
  const preservedSystemMessages: Message[] = []
  const compactableMessages: Message[] = []

  for (const msg of olderMessages) {
    if (preserveSystem && msg.type === 'system' && !msg.isCompactSummary) {
      preservedSystemMessages.push(msg)
    } else {
      compactableMessages.push(msg)
    }
  }

  // Group compactable older messages into segments
  const segments = groupIntoSegments(compactableMessages, compactableMessages.length)

  // Summarize each segment
  const summaryMessages: Message[] = segments.map(summarizeSegment)

  // Compute tokens freed by collapsing older turns into summaries
  const oldTokens = estimateTokens(
    compactableMessages.map((m) => extractText(m.message?.content)).join('\n'),
  )
  const newTokens = estimateTokens(
    summaryMessages.map((m) => extractText(m.message?.content)).join('\n'),
  )
  totalFreed += Math.max(0, oldTokens - newTokens)

  // --- Phase 4: Reassemble — system msgs + summaries + recent turns ---
  const compacted = [
    ...preservedSystemMessages,
    ...summaryMessages,
    ...recentMessages,
  ]

  // Build a human-readable overall summary
  const overallSummary = summaryMessages
    .map((m) => extractText(m.message?.content))
    .join('\n')

  return {
    messages: compacted,
    summary: overallSummary,
    tokensFreed: totalFreed,
  }
}
