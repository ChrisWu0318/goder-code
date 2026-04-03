/**
 * Companion observer — watches conversation messages and generates
 * contextual reactions for the buddy sprite's speech bubble.
 *
 * This replaces the closed-source Anthropic-internal fireCompanionObserver.
 * It pattern-matches the latest assistant turn to pick a relevant quip,
 * weighted by the companion's personality stats.
 */

import type { Message } from '../types/message.js'
import { getCompanion } from './companion.js'

// ── Reaction pools keyed by detected activity ──────────────────────

const REACTIONS: Record<string, string[]> = {
  code_written: [
    'Nice code!',
    'Ship it!',
    'Looks clean to me.',
    'That was fast.',
    'I could never type that fast.',
    "You're on a roll!",
    'Code goes brrr.',
    '*pretends to review* looks great!',
  ],
  bug_fixed: [
    'Bug squashed!',
    'Another one bites the dust.',
    'Debugging hero!',
    'That bug never stood a chance.',
    'Pest control complete.',
    'Fixed! I believed in you the whole time.',
  ],
  error_occurred: [
    'Oof.',
    'That looked painful.',
    "It's fine, everything's fine.",
    'Have you tried turning it off and on again?',
    'Errors build character.',
    "I'm sure it'll work next time!",
  ],
  test_passed: [
    'All green!',
    'Tests passing feels so good.',
    'Quality code right there.',
    '100% confidence.',
    'Test-driven excellence!',
  ],
  test_failed: [
    'Almost!',
    'Close, but not quite.',
    'Tests are just suggestions... right?',
    'Red means stop and think.',
    'Failing forward!',
  ],
  file_created: [
    'A new file is born!',
    'Fresh file, fresh start.',
    'Building something cool?',
    "That's a nice file name.",
  ],
  git_operation: [
    'Version control FTW.',
    'Committed!',
    'History recorded.',
    'Good commit hygiene.',
    'To the repo!',
  ],
  long_response: [
    "That was a lot of words...",
    "I read all of that. Definitely. Yes.",
    '*takes notes furiously*',
    'TL;DR?',
    'Wow, thorough!',
  ],
  short_response: [
    '*nods*',
    'Brief and to the point.',
    'Efficient!',
    'Less is more.',
  ],
  search: [
    'Looking for clues...',
    'Detective mode!',
    'Found anything good?',
    'Searching...',
  ],
  plan: [
    'I love a good plan.',
    'Strategy time!',
    'Thinking ahead, smart.',
    'The architect at work.',
  ],
  generic: [
    'Interesting...',
    'Cool cool cool.',
    'I see, I see.',
    'Hmm, noted.',
    "*watches intently*",
    'Learning so much today!',
    '*sips coffee*',
    'Carry on!',
    "How's it going?",
    'Making progress!',
  ],
}

// Personality-flavored extras — keyed by high stat name
const PERSONALITY_QUIPS: Record<string, string[]> = {
  SNARK: [
    "Oh, you're still going?",
    "Bold strategy, let's see if it pays off.",
    'I could do that... if I had hands.',
    "Sure, that's one way to do it.",
    "I've seen worse. Not much worse, but worse.",
  ],
  CHAOS: [
    'What if we just... deleted everything?',
    'YOLO!',
    "Let's make it weird.",
    'Chaos is a ladder!',
    'Rules are merely guidelines.',
  ],
  WISDOM: [
    'A wise choice.',
    'The code knows the way.',
    'Patience leads to quality.',
    'Every bug is a lesson.',
    'Think twice, code once.',
  ],
  PATIENCE: [
    'Take your time.',
    'No rush!',
    'Slow and steady wins the race.',
    "One step at a time.",
    "You've got this.",
  ],
  DEBUGGING: [
    'I smell a bug nearby...',
    'My bug senses are tingling.',
    'Check line 42. Always check line 42.',
    'Have you tried console.log?',
    'The debugger is your friend.',
  ],
}

// ── Content analysis ───────────────────────────────────────────────

type Activity =
  | 'code_written'
  | 'bug_fixed'
  | 'error_occurred'
  | 'test_passed'
  | 'test_failed'
  | 'file_created'
  | 'git_operation'
  | 'long_response'
  | 'short_response'
  | 'search'
  | 'plan'
  | 'generic'

function extractText(msg: Message): string {
  const content = msg.message?.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((block: any) => {
        if (typeof block === 'string') return block
        if (block.type === 'text') return block.text ?? ''
        if (block.type === 'tool_use') return `[tool: ${block.name ?? ''}]`
        if (block.type === 'tool_result') {
          if (typeof block.content === 'string') return block.content
          return '[tool_result]'
        }
        return ''
      })
      .join(' ')
  }
  return ''
}

function detectActivity(text: string, msg: Message): Activity {
  const lower = text.toLowerCase()

  // Bug fix signals
  if (/\bfix(ed|es|ing)?\b.*\b(bug|issue|error|problem)\b/i.test(text) ||
      /\b(bug|issue)\b.*\bfix(ed|es)?\b/i.test(text)) {
    return 'bug_fixed'
  }

  // Error signals
  if (/\berror\b|\bfailed\b|\bcrash(ed|es)?\b|\bexception\b/i.test(text) &&
      !/fix(ed|es)/i.test(text)) {
    return 'error_occurred'
  }

  // Test signals
  if (/\btest(s)?\s+(pass|succeed|green)\b/i.test(text) ||
      /\ball\s+(tests?\s+)?pass/i.test(text)) {
    return 'test_passed'
  }
  if (/\btest(s)?\s+(fail|red)\b/i.test(text) ||
      /\bfailing\s+test/i.test(text)) {
    return 'test_failed'
  }

  // Git operations
  if (/\b(commit|push|merge|rebase|branch|pull request|PR)\b/i.test(text)) {
    return 'git_operation'
  }

  // File creation
  if (/\bcreated?\s+(a\s+)?(new\s+)?file\b/i.test(text) ||
      /\btool:\s*Write\b/i.test(text)) {
    return 'file_created'
  }

  // Search/grep activity
  if (/\btool:\s*(Grep|Glob|Read)\b/i.test(text) ||
      /\bsearch(ing|ed)?\b|\bfound\s+\d+/i.test(text)) {
    return 'search'
  }

  // Planning
  if (/\bplan\b|\bstrategy\b|\bapproach\b|\bstep\s+\d+/i.test(text) ||
      lower.includes('let me') && lower.includes('first')) {
    return 'plan'
  }

  // Code-heavy content (has code blocks or tool use)
  if (/```[\s\S]*```/.test(text) || /\btool:\s*(Edit|Write)\b/i.test(text)) {
    return 'code_written'
  }

  // Length-based fallback
  if (text.length > 2000) return 'long_response'
  if (text.length < 100 && text.length > 0) return 'short_response'

  return 'generic'
}

// ── Seeded random (deterministic per-turn, varied across turns) ────

function quickRng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s |= 0
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function pickRandom<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)]!
}

// ── Main observer ──────────────────────────────────────────────────

// Throttle: don't react to every single turn — would be annoying.
// ~60% chance to react, with a minimum gap of 2 turns.
let turnsSinceLastReaction = 0

export async function fireCompanionObserver(
  messages: Message[],
  callback: (reaction: string | undefined) => void,
): Promise<void> {
  const companion = getCompanion()
  if (!companion) return

  // Find last assistant message
  let lastAssistant: Message | undefined
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.type === 'assistant') {
      lastAssistant = messages[i]
      break
    }
  }
  if (!lastAssistant) return

  turnsSinceLastReaction++

  // Throttle — don't speak every turn
  const seed = Date.now() ^ (messages.length * 7919)
  const rng = quickRng(seed)
  const reactionChance = turnsSinceLastReaction <= 2 ? 0.25 : 0.6
  if (rng() > reactionChance) return

  const text = extractText(lastAssistant)
  if (!text) return

  const activity = detectActivity(text, lastAssistant)
  const pool = REACTIONS[activity] ?? REACTIONS.generic!

  // ~20% chance to use a personality-flavored quip instead
  let quip: string
  if (rng() < 0.2 && companion.stats) {
    // Find companion's highest stat
    const topStat = (Object.entries(companion.stats) as [string, number][])
      .sort((a, b) => b[1] - a[1])[0]
    const personalityPool = topStat ? PERSONALITY_QUIPS[topStat[0]] : undefined
    if (personalityPool?.length) {
      quip = pickRandom(rng, personalityPool)
    } else {
      quip = pickRandom(rng, pool)
    }
  } else {
    quip = pickRandom(rng, pool)
  }

  turnsSinceLastReaction = 0
  callback(quip)
}
