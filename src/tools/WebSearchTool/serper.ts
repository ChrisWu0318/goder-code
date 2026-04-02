import { logError } from '../../utils/log.js'
import type { SearchResult } from './WebSearchTool.js'

interface SerperOrganicResult {
  title: string
  link: string
  snippet?: string
}

interface SerperResponse {
  organic?: SerperOrganicResult[]
  answerBox?: { answer?: string; snippet?: string; title?: string }
  knowledgeGraph?: { description?: string; title?: string }
}

/**
 * Returns the Serper API key if configured, or undefined.
 */
export function getSerperApiKey(): string | undefined {
  return process.env.SERPER_API_KEY || undefined
}

/**
 * Perform a web search using the Serper.dev Google Search API.
 * Returns results in the same format as the Anthropic server-side web search.
 */
export async function searchWithSerper(
  query: string,
  signal?: AbortSignal,
): Promise<{
  results: (SearchResult | string)[]
}> {
  const apiKey = getSerperApiKey()
  if (!apiKey) {
    return {
      results: ['Web search error: SERPER_API_KEY is not configured'],
    }
  }

  try {
    const response = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: {
        'X-API-KEY': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        q: query,
        num: 10,
      }),
      signal,
    })

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      const errorMsg = `Serper API error ${response.status}: ${text.slice(0, 200)}`
      logError(new Error(errorMsg))
      return { results: [errorMsg] }
    }

    const data = (await response.json()) as SerperResponse
    const results: (SearchResult | string)[] = []

    // Add knowledge graph / answer box as text if available
    if (data.answerBox?.answer) {
      results.push(data.answerBox.answer)
    } else if (data.answerBox?.snippet) {
      results.push(data.answerBox.snippet)
    }
    if (data.knowledgeGraph?.description) {
      results.push(
        `${data.knowledgeGraph.title ?? ''}: ${data.knowledgeGraph.description}`,
      )
    }

    // Convert organic results to SearchResult format
    if (data.organic && data.organic.length > 0) {
      const hits = data.organic.map(r => ({
        title: r.title,
        url: r.link,
      }))
      results.push({
        tool_use_id: `serper-${Date.now()}`,
        content: hits,
      })

      // Add snippets as text summary
      const snippets = data.organic
        .filter(r => r.snippet)
        .map(r => `- **${r.title}** (${r.link})\n  ${r.snippet}`)
        .join('\n')
      if (snippets) {
        results.push(snippets)
      }
    }

    if (results.length === 0) {
      results.push('No search results found.')
    }

    return { results }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error
    }
    const msg = `Serper search failed: ${error instanceof Error ? error.message : String(error)}`
    logError(new Error(msg))
    return { results: [msg] }
  }
}
