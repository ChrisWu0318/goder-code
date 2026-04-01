import { feature } from 'bun:bundle'
import {
  getClaudeAIOAuthTokens,
  isAnthropicAuthEnabled,
} from '../utils/auth.js'

/**
 * Kill-switch check for voice mode. In Goder Code, voice mode is always
 * available when VOICE_MODE feature flag is enabled (no GrowthBook dependency).
 */
export function isVoiceGrowthBookEnabled(): boolean {
  return feature('VOICE_MODE') ? true : false
}

/**
 * Auth check for voice mode. Returns true when the user has either:
 * 1. A Groq API key (GROQ_API_KEY) for Whisper STT
 * 2. A direct OpenAI API key (OPENAI_API_KEY without CLAUDE_CODE_USE_OPENAI_COMPAT)
 * 3. Explicit Goder STT config (GODER_STT_API_KEY)
 * 4. Anthropic OAuth token (original path)
 */
export function hasVoiceAuth(): boolean {
  // Goder: check HTTP STT providers first
  if (
    process.env.GODER_STT_API_KEY ||
    process.env.GROQ_API_KEY ||
    (process.env.OPENAI_API_KEY && !process.env.CLAUDE_CODE_USE_OPENAI_COMPAT)
  ) {
    return true
  }
  // Fallback: Anthropic OAuth
  if (!isAnthropicAuthEnabled()) {
    return false
  }
  const tokens = getClaudeAIOAuthTokens()
  return Boolean(tokens?.accessToken)
}

/**
 * Full runtime check: auth + feature flag. For React render paths
 * use useVoiceEnabled() instead (memoizes the auth half).
 */
export function isVoiceModeEnabled(): boolean {
  return hasVoiceAuth() && isVoiceGrowthBookEnabled()
}
