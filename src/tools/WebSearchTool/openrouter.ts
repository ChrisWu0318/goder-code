import { logError } from '../../utils/log.js'
import type { SearchResult } from './WebSearchTool.js'

interface OpenRouterAnnotation {
  type: string
  url_citation?: {
    url: string
    title: string
    content?: string
  }
}

interface OpenRouterChoice {
  message?: {
    content?: string | null
    annotations?: OpenRouterAnnotation[]
  }
}

interface OpenRouterResponse {
  choices?: OpenRouterChoice[]
  error?: { message?: string; code?: number }
}

/**
 * Perform a web search via OpenRouter's `openrouter:web_search` server tool.
 *
 * Makes a direct fetch to OpenRouter's chat/completions endpoint (OpenAI-compatible)
 * because the Anthropic SDK path (used for normal model calls) doesn't support
 * OpenRouter-specific tool types.
 */
export async function searchWithOpenRouter(
  query: string,
  model: string,
  signal?: AbortSignal,
): Promise<{ results: (SearchResult | string)[] }> {
  // Goder: resolve base URL and API key from either Anthropic or OpenAI-compat env vars.
  // Priority: ANTHROPIC_BASE_URL > OPENAI_BASE_URL (for OpenAI-compat mode)
  const baseUrl = process.env.ANTHROPIC_BASE_URL || process.env.OPENAI_BASE_URL
  const apiKey = process.env.OPENROUTER_API_KEY || process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY

  if (!baseUrl || !apiKey) {
    return {
      results: ['Web search error: OpenRouter base URL or API key not configured'],
    }
  }

  // Normalize: ensure we hit /chat/completions, not /v1/chat/completions/chat/completions
  const normalized = baseUrl.replace(/\/+$/, '')
  const url = normalized.endsWith('/chat/completions')
    ? normalized
    : `${normalized}/chat/completions`

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        // In OpenAI-compat mode, mainLoopModel is the Anthropic model name (e.g. claude-sonnet-4-20250514),
        // not the actual OpenRouter model. Use OPENAI_MODEL env var as the real model identifier.
        model: process.env.OPENAI_MODEL || model,
        messages: [
          {
            role: 'user',
            content: `Search the web for: ${query}`,
          },
        ],
        tools: [
          {
            type: 'openrouter:web_search',
            parameters: {
              max_results: 10,
              search_context_size: 'medium',
            },
          },
        ],
        max_tokens: 2048,
      }),
      signal,
    })

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      const errorMsg = `OpenRouter web search error ${response.status}: ${text.slice(0, 300)}`
      logError(new Error(errorMsg))
      return { results: [errorMsg] }
    }

    const data = (await response.json()) as OpenRouterResponse

    if (data.error) {
      const errorMsg = `OpenRouter error: ${data.error.message ?? 'unknown'}`
      logError(new Error(errorMsg))
      return { results: [errorMsg] }
    }

    const message = data.choices?.[0]?.message
    const results: (SearchResult | string)[] = []

    // Extract url_citation annotations as SearchResult
    const citations = message?.annotations?.filter(
      a => a.type === 'url_citation' && a.url_citation,
    )
    if (citations && citations.length > 0) {
      results.push({
        tool_use_id: `openrouter-${Date.now()}`,
        content: citations.map(a => ({
          title: a.url_citation!.title,
          url: a.url_citation!.url,
        })),
      })
    }

    // Add the model's text summary (useful context for the main model)
    if (message?.content) {
      results.push(message.content)
    }

    if (results.length === 0) {
      results.push('No search results found.')
    }

    return { results }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error
    }
    const msg = `OpenRouter web search failed: ${error instanceof Error ? error.message : String(error)}`
    logError(new Error(msg))
    return { results: [msg] }
  }
}
