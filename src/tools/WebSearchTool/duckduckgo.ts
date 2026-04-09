import { logError } from '../../utils/log.js'
import type { SearchResult } from './WebSearchTool.js'

/**
 * Perform a web search using DuckDuckGo's free HTML interface.
 * No API key required.
 */
export async function searchWithDuckDuckGo(
  query: string,
  signal?: AbortSignal,
): Promise<{ results: (SearchResult | string)[] }> {
  try {
    const response = await fetch('https://html.duckduckgo.com/html/', {
      method: 'POST',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'text/html,application/xhtml+xml',
      },
      body: new URLSearchParams({ q: query }),
      signal,
    })

    if (!response.ok) {
      return { results: [`DuckDuckGo HTTP error ${response.status}`] }
    }

    const html = await response.text()
    const results: (SearchResult | string)[] = []
    const hits: { title: string; url: string }[] = []
    const snippets: string[] = []

    // Parse results from DDG HTML.
    // Each result block: <h2 class="result__title">...</h2> followed by
    // extras + <a class="result__snippet">...</a>, then next result__title or end.
    const resultRegex =
      /<h2 class="result__title">([\s\S]*?)<\/h2>([\s\S]*?)(?=<h2 class="result__title">|$)/gi
    const titleRegex =
      /<a\s+rel="nofollow"\s+class="result__a"[^>]*>\s*([^<]+(?:<b>[^<]*<\/b>[^<]*)*)/i
    const hrefRegex =
      /<a\s+rel="nofollow"\s+class="result__a"[^>]*href="([^"]*)"/i
    const snippetRegex =
      /<a\s+class="result__snippet"[^>]*>\s*([\s\S]*?)\s*<\/a>/i

    let match
    while ((match = resultRegex.exec(html)) !== null) {
      const titleBlock = match[1]
      const restBlock = match[2] || ''
      const block = titleBlock + restBlock
      const titleMatch = titleRegex.exec(block)
      const hrefMatch = hrefRegex.exec(block)
      const snippetMatch = snippetRegex.exec(block)

      if (hrefMatch) {
        // Decode the /l/?uddg= redirect URL
        let url = hrefMatch[1]
        if (url.startsWith('/l/?uddg=')) {
          try {
            url = decodeURIComponent(url.replace('/l/?uddg=', ''))
          } catch {
            // keep the raw URL if decoding fails
          }
        }

        const title = titleMatch ? titleMatch[1].replace(/<[^>]*>/g, '').trim() : ''
        const snippet = snippetMatch
          ? snippetMatch[1].replace(/<[^>]*>/g, '').trim()
          : ''

        hits.push({ title, url })
        if (snippet) snippets.push(snippet)
      }
    }

    if (hits.length > 0) {
      results.push({
        tool_use_id: `ddg-${Date.now()}`,
        content: hits,
      })
    }

    if (snippets.length > 0) {
      results.push(snippets.map(s => `- ${s}`).join('\n'))
    }

    if (results.length === 0) {
      results.push('No search results found.')
    }

    return { results }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error
    }
    const msg = `DuckDuckGo search failed: ${error instanceof Error ? error.message : String(error)}`
    logError(new Error(msg))
    return { results: [msg] }
  }
}
