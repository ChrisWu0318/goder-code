/**
 * OpenAI-Compatible API Adapter for Claude Code
 *
 * Translates between the Anthropic SDK interface (used throughout the codebase)
 * and OpenAI-compatible API format (used by OpenRouter, Ollama, vLLM, LiteLLM, etc.)
 *
 * Environment variables:
 *   OPENAI_API_KEY        — API key for the provider
 *   OPENAI_BASE_URL       — Base URL (e.g. https://openrouter.ai/api/v1)
 *   OPENAI_MODEL          — Model identifier (e.g. qwen/qwen3-235b-a22b)
 *
 * Usage: set CLAUDE_CODE_USE_OPENAI_COMPAT=1 to enable this adapter.
 */

// ---------- Types ----------

// OpenAI Chat Completions request
interface OAIChatRequest {
  model: string
  messages: OAIMessage[]
  tools?: OAITool[]
  tool_choice?: 'auto' | 'none' | { type: 'function'; function: { name: string } }
  stream: boolean
  stream_options?: { include_usage: boolean }
  max_tokens?: number
  temperature?: number
  stop?: string[]
}

interface OAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | OAIContentPart[] | null
  tool_calls?: OAIToolCall[]
  tool_call_id?: string
  name?: string
}

interface OAIContentPart {
  type: 'text' | 'image_url'
  text?: string
  image_url?: { url: string; detail?: string }
}

interface OAITool {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

interface OAIToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
  index?: number
}

// OpenAI streaming SSE chunks
interface OAIStreamChunk {
  id: string
  object: string
  created: number
  model: string
  choices: {
    index: number
    delta: {
      role?: string
      content?: string | null
      reasoning_content?: string | null  // DeepSeek/QwQ reasoning field
      tool_calls?: {
        index: number
        id?: string
        type?: string
        function?: {
          name?: string
          arguments?: string
        }
      }[]
    }
    finish_reason: string | null
  }[]
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}

// Anthropic types (minimal — just what the codebase consumes)
interface AnthropicStreamEvent {
  type: string
  [key: string]: unknown
}

// ---------- Request Conversion: Anthropic → OpenAI ----------

function convertSystemPrompt(
  system: unknown[] | string | undefined,
): OAIMessage[] {
  if (!system) return []
  if (typeof system === 'string') {
    return [{ role: 'system', content: system }]
  }
  // system is an array of content blocks
  const text = (system as { type: string; text?: string }[])
    .filter(b => b.type === 'text' && b.text)
    .map(b => b.text!)
    .join('\n\n')
  return text ? [{ role: 'system', content: text }] : []
}

function convertMessages(messages: unknown[]): OAIMessage[] {
  const result: OAIMessage[] = []

  for (const msg of messages as {
    role: string
    content: unknown
  }[]) {
    if (msg.role === 'user') {
      result.push(...convertUserMessage(msg))
    } else if (msg.role === 'assistant') {
      result.push(convertAssistantMessage(msg))
    }
  }

  return result
}

function convertUserMessage(
  msg: { role: string; content: unknown },
): OAIMessage[] {
  const results: OAIMessage[] = []

  if (typeof msg.content === 'string') {
    results.push({ role: 'user', content: msg.content })
    return results
  }

  if (!Array.isArray(msg.content)) {
    results.push({ role: 'user', content: String(msg.content ?? '') })
    return results
  }

  // Process content blocks — separate tool_result from other content
  const textParts: OAIContentPart[] = []
  const toolResults: OAIMessage[] = []

  for (const block of msg.content as {
    type: string
    text?: string
    tool_use_id?: string
    content?: unknown
    is_error?: boolean
    source?: { type: string; media_type?: string; data?: string; url?: string }
  }[]) {
    switch (block.type) {
      case 'text':
        if (block.text) {
          textParts.push({ type: 'text', text: block.text })
        }
        break

      case 'tool_result': {
        let resultText = ''
        const resultImages: OAIContentPart[] = []
        if (typeof block.content === 'string') {
          resultText = block.content
        } else if (Array.isArray(block.content)) {
          for (const b of block.content as {
            type: string
            text?: string
            source?: { type: string; media_type?: string; data?: string; url?: string }
          }[]) {
            if (b.type === 'text' && b.text) {
              resultText += (resultText ? '\n' : '') + b.text
            } else if (b.type === 'image' && b.source) {
              // Convert image blocks inside tool_result to image_url
              if (b.source.type === 'base64' && b.source.data) {
                resultImages.push({
                  type: 'image_url',
                  image_url: {
                    url: `data:${b.source.media_type ?? 'image/png'};base64,${b.source.data}`,
                  },
                })
              } else if (b.source.type === 'url' && b.source.url) {
                resultImages.push({
                  type: 'image_url',
                  image_url: { url: b.source.url },
                })
              }
            }
          }
        }
        if (block.is_error) {
          resultText = `[ERROR] ${resultText}`
        }
        // If there are images inside tool_result, send them as a user message
        // (OpenAI tool messages don't support image_url content parts)
        if (resultImages.length > 0) {
          const parts: OAIContentPart[] = []
          if (resultText) {
            parts.push({ type: 'text', text: resultText })
          }
          parts.push(...resultImages)
          // Tool result text goes as tool message, images as a follow-up user message
          toolResults.push({
            role: 'tool',
            tool_call_id: block.tool_use_id ?? '',
            content: resultText || '(tool returned image content)',
          })
          textParts.push(...resultImages)
        } else {
          toolResults.push({
            role: 'tool',
            tool_call_id: block.tool_use_id ?? '',
            content: resultText || '(empty result)',
          })
        }
        break
      }

      case 'image': {
        if (block.source?.type === 'base64' && block.source.data) {
          textParts.push({
            type: 'image_url',
            image_url: {
              url: `data:${block.source.media_type ?? 'image/png'};base64,${block.source.data}`,
            },
          })
        } else if (block.source?.type === 'url' && block.source.url) {
          textParts.push({
            type: 'image_url',
            image_url: { url: block.source.url },
          })
        }
        break
      }

      case 'document': {
        // OpenAI API doesn't support document blocks (PDF etc.)
        // Convert to a text placeholder — the content will be available
        // if the model supports it via the image retry path, otherwise
        // the user gets a clear message that the content was not processed.
        const mediaType = block.source?.media_type ?? 'unknown'
        textParts.push({
          type: 'text',
          text: `[Document content (${mediaType}) — this model/provider does not support inline document input. Consider converting the document to text first, or use a model that supports PDF input.]`,
        })
        break
      }

      // thinking, etc. — extract text if present
      default:
        if (block.text) {
          textParts.push({ type: 'text', text: block.text })
        }
        break
    }
  }

  // Emit text/image parts first, then tool results
  if (textParts.length > 0) {
    if (textParts.length === 1 && textParts[0].type === 'text') {
      results.push({ role: 'user', content: textParts[0].text! })
    } else {
      results.push({ role: 'user', content: textParts })
    }
  }

  results.push(...toolResults)
  return results
}

function convertAssistantMessage(msg: {
  role: string
  content: unknown
}): OAIMessage {
  if (typeof msg.content === 'string') {
    return { role: 'assistant', content: msg.content }
  }

  if (!Array.isArray(msg.content)) {
    return { role: 'assistant', content: String(msg.content ?? '') }
  }

  const blocks = msg.content as {
    type: string
    text?: string
    thinking?: string
    id?: string
    name?: string
    input?: unknown
  }[]

  // Collect text parts and tool_use blocks
  const textParts: string[] = []
  const toolCalls: OAIToolCall[] = []

  for (const block of blocks) {
    switch (block.type) {
      case 'text':
        if (block.text) textParts.push(block.text)
        break
      case 'thinking':
        // Include thinking as text in <think> tags so models that support
        // thinking can see their previous reasoning
        if (block.thinking) {
          textParts.push(`<think>\n${block.thinking}\n</think>`)
        }
        break
      case 'tool_use':
        toolCalls.push({
          id: block.id ?? `call_${Math.random().toString(36).slice(2, 11)}`,
          type: 'function',
          function: {
            name: block.name ?? '',
            arguments:
              typeof block.input === 'string'
                ? block.input
                : JSON.stringify(block.input ?? {}),
          },
        })
        break
    }
  }

  return {
    role: 'assistant',
    content: textParts.join('\n') || null,
    ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
  }
}

function convertTools(tools: unknown[] | undefined): OAITool[] | undefined {
  if (!tools || tools.length === 0) return undefined

  return (
    tools as {
      type?: string
      name: string
      description: string
      input_schema: Record<string, unknown>
    }[]
  )
    .filter(t => t.type !== 'advisor_20260301') // Skip server-side tools
    .map(t => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema,
      },
    }))
}

/**
 * Strip image_url content parts from all messages.
 * When the target model doesn't support vision, we retry without images
 * and prepend a notice so the user knows images were dropped.
 */
function stripImagesFromMessages(messages: OAIMessage[]): OAIMessage[] {
  return messages.map(msg => {
    if (!Array.isArray(msg.content)) return msg
    const filtered = (msg.content as OAIContentPart[]).filter(
      p => p.type !== 'image_url',
    )
    if (filtered.length === msg.content.length) return msg // no images removed
    // If only images were in the message, replace with a text notice
    if (filtered.length === 0) {
      return { ...msg, content: '[Image content removed: current model does not support image input]' }
    }
    return { ...msg, content: filtered }
  })
}

function buildOAIRequest(params: Record<string, unknown>, stripImages = false): OAIChatRequest {
  const system = convertSystemPrompt(params.system as unknown[] | string)
  let messages = convertMessages(params.messages as unknown[])
  const tools = convertTools(params.tools as unknown[])

  if (stripImages) {
    messages = stripImagesFromMessages(messages)
  }

  // Determine model: use OPENAI_MODEL env or the model from params
  const model =
    process.env.OPENAI_MODEL ?? (params.model as string) ?? 'gpt-4o'

  const request: OAIChatRequest = {
    model,
    messages: [...system, ...messages],
    stream: true,
    stream_options: { include_usage: true },
    max_tokens: (params.max_tokens as number) ?? 16384,
  }

  if (tools && tools.length > 0) {
    request.tools = tools
    request.tool_choice = 'auto'
  }

  // Only set temperature if thinking is not enabled
  // (models with thinking may ignore or error on temperature)
  if (!params.thinking) {
    request.temperature = (params.temperature as number) ?? undefined
  }

  return request
}

// ---------- Response Conversion: OpenAI SSE → Anthropic Events ----------

// State machine for tracking content blocks during streaming
interface StreamState {
  messageId: string
  model: string
  blockIndex: number
  activeTextBlock: boolean
  activeThinkingBlock: boolean
  toolCallMap: Map<number, { blockIndex: number; id: string; name: string; arguments: string }>
  inputTokens: number
  outputTokens: number
  finishReason: string | null
}

function createStreamState(): StreamState {
  return {
    messageId: '',
    model: '',
    blockIndex: 0,
    activeTextBlock: false,
    activeThinkingBlock: false,
    toolCallMap: new Map(),
    inputTokens: 0,
    outputTokens: 0,
    finishReason: null,
  }
}

function mapFinishReason(reason: string | null): string | null {
  switch (reason) {
    case 'stop':
      return 'end_turn'
    case 'tool_calls':
      return 'tool_use'
    case 'length':
      return 'max_tokens'
    case 'content_filter':
      return 'end_turn'
    default:
      return reason
  }
}

/**
 * Convert a stream of OpenAI SSE chunks into Anthropic-format stream events.
 * This is the core of the adapter.
 */
async function* convertStream(
  oaiStream: AsyncIterable<OAIStreamChunk>,
  state: StreamState,
): AsyncIterable<AnthropicStreamEvent> {
  let firstChunk = true

  for await (const chunk of oaiStream) {
    if (firstChunk) {
      firstChunk = false
      state.messageId = chunk.id ?? `msg_${Date.now()}`
      state.model = chunk.model ?? process.env.OPENAI_MODEL ?? 'unknown'

      // Emit message_start
      yield {
        type: 'message_start',
        message: {
          id: state.messageId,
          type: 'message',
          role: 'assistant',
          content: [],
          model: state.model,
          stop_reason: null,
          stop_sequence: null,
          usage: {
            input_tokens: 0,
            output_tokens: 0,
          },
        },
      }
    }

    // Process usage if present
    if (chunk.usage) {
      state.inputTokens = chunk.usage.prompt_tokens ?? 0
      state.outputTokens = chunk.usage.completion_tokens ?? 0
    }

    for (const choice of chunk.choices ?? []) {
      const delta = choice.delta
      if (!delta) continue

      // Track finish reason
      if (choice.finish_reason) {
        state.finishReason = choice.finish_reason
      }

      // Handle reasoning_content (DeepSeek/QwQ thinking)
      // Emitted as Anthropic-style thinking blocks so the UI renders them
      if (delta.reasoning_content != null && delta.reasoning_content !== '') {
        if (!state.activeThinkingBlock) {
          // Close text block if one is open
          if (state.activeTextBlock) {
            yield { type: 'content_block_stop', index: state.blockIndex }
            state.blockIndex++
            state.activeTextBlock = false
          }
          yield {
            type: 'content_block_start',
            index: state.blockIndex,
            content_block: { type: 'thinking', thinking: '' },
          }
          state.activeThinkingBlock = true
        }
        yield {
          type: 'content_block_delta',
          index: state.blockIndex,
          delta: { type: 'thinking_delta', thinking: delta.reasoning_content },
        }
      }

      // Handle text content
      if (delta.content != null && delta.content !== '') {
        // Close thinking block if transitioning to text
        if (state.activeThinkingBlock) {
          yield { type: 'content_block_stop', index: state.blockIndex }
          state.blockIndex++
          state.activeThinkingBlock = false
        }
        if (!state.activeTextBlock) {
          // Start a new text block
          yield {
            type: 'content_block_start',
            index: state.blockIndex,
            content_block: { type: 'text', text: '' },
          }
          state.activeTextBlock = true
        }
        yield {
          type: 'content_block_delta',
          index: state.blockIndex,
          delta: { type: 'text_delta', text: delta.content },
        }
      }

      // Handle tool calls
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const tcIndex = tc.index ?? 0
          let existing = state.toolCallMap.get(tcIndex)

          if (tc.id || tc.function?.name) {
            // New tool call — close any open content blocks first
            if (state.activeThinkingBlock) {
              yield { type: 'content_block_stop', index: state.blockIndex }
              state.blockIndex++
              state.activeThinkingBlock = false
            }
            if (state.activeTextBlock) {
              yield { type: 'content_block_stop', index: state.blockIndex }
              state.blockIndex++
              state.activeTextBlock = false
            }

            // Close previous tool call at this index if somehow reused
            if (existing) {
              yield {
                type: 'content_block_stop',
                index: existing.blockIndex,
              }
              state.blockIndex++
            }

            existing = {
              blockIndex: state.blockIndex,
              id: tc.id ?? `call_${Math.random().toString(36).slice(2, 11)}`,
              name: tc.function?.name ?? '',
              arguments: '',
            }
            state.toolCallMap.set(tcIndex, existing)

            // Emit content_block_start for tool_use
            yield {
              type: 'content_block_start',
              index: existing.blockIndex,
              content_block: {
                type: 'tool_use',
                id: existing.id,
                name: existing.name,
                input: '',
              },
            }
          }

          // Accumulate arguments
          if (tc.function?.arguments && existing) {
            existing.arguments += tc.function.arguments
            yield {
              type: 'content_block_delta',
              index: existing.blockIndex,
              delta: {
                type: 'input_json_delta',
                partial_json: tc.function.arguments,
              },
            }
          }
        }
      }
    }
  }

  // Close any remaining open blocks
  if (state.activeThinkingBlock) {
    yield { type: 'content_block_stop', index: state.blockIndex }
  }
  if (state.activeTextBlock) {
    yield { type: 'content_block_stop', index: state.blockIndex }
  }

  for (const [, tc] of state.toolCallMap) {
    yield {
      type: 'content_block_stop',
      index: tc.blockIndex,
    }
  }

  // Emit message_delta with stop reason
  const stopReason =
    mapFinishReason(state.finishReason) ??
    (state.toolCallMap.size > 0 ? 'tool_use' : 'end_turn')

  yield {
    type: 'message_delta',
    delta: {
      stop_reason: stopReason,
      stop_sequence: null,
    },
    usage: {
      input_tokens: state.inputTokens,
      output_tokens: state.outputTokens,
    },
  }

  // Emit message_stop
  yield { type: 'message_stop' }
}

// ---------- SSE Parser ----------

async function* parseSSEStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): AsyncIterable<OAIStreamChunk> {
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed === ':') continue
      if (trimmed === 'data: [DONE]') return

      if (trimmed.startsWith('data: ')) {
        const json = trimmed.slice(6)
        try {
          yield JSON.parse(json) as OAIStreamChunk
        } catch {
          // Skip malformed JSON chunks
        }
      }
    }
  }

  // Process any remaining buffer
  if (buffer.trim().startsWith('data: ') && buffer.trim() !== 'data: [DONE]') {
    try {
      yield JSON.parse(buffer.trim().slice(6)) as OAIStreamChunk
    } catch {
      // Skip
    }
  }
}

// ---------- Proxy Client ----------

/**
 * Creates a fake Anthropic-SDK-compatible client that translates
 * all calls to OpenAI-compatible chat/completions endpoint.
 *
 * The returned object duck-types `Anthropic` — only the methods
 * the codebase actually calls are implemented.
 */
export function createOpenAICompatClient(options: {
  apiKey?: string
  baseURL?: string
  maxRetries?: number
  timeout?: number
  defaultHeaders?: Record<string, string>
}): unknown {
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY ?? ''
  const baseURL = (
    options.baseURL ??
    process.env.OPENAI_BASE_URL ??
    'https://openrouter.ai/api/v1'
  ).replace(/\/+$/, '')

  const maxRetries = options.maxRetries ?? 2
  const timeout = options.timeout ?? 600_000

  async function fetchWithRetry(
    url: string,
    init: RequestInit,
    retriesLeft: number,
  ): Promise<Response> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeout)

    // Merge signals if caller provided one
    const callerSignal = init.signal
    if (callerSignal) {
      callerSignal.addEventListener('abort', () => controller.abort())
    }

    try {
      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
      })

      if (!response.ok && retriesLeft > 0 && response.status >= 500) {
        return fetchWithRetry(url, init, retriesLeft - 1)
      }

      if (!response.ok) {
        const body = await response.text().catch(() => '')
        throw Object.assign(
          new Error(`API error ${response.status}: ${body.slice(0, 500)}`),
          {
            status: response.status,
            statusText: response.statusText,
            requestID: response.headers.get('x-request-id'),
          },
        )
      }

      return response
    } finally {
      clearTimeout(timer)
    }
  }

  /**
   * Detect if an error indicates the model/provider doesn't support image input.
   */
  function isImageNotSupportedError(err: unknown): boolean {
    if (!(err instanceof Error)) return false
    const msg = err.message.toLowerCase()
    return (
      (msg.includes('image') && (msg.includes('not support') || msg.includes('no endpoints'))) ||
      msg.includes('does not support image') ||
      msg.includes('image input') ||
      msg.includes('vision is not supported') ||
      msg.includes('image_url is not supported')
    )
  }

  /**
   * Check whether the OAI request contains any image_url content parts.
   */
  function requestHasImages(req: OAIChatRequest): boolean {
    return req.messages.some(
      m =>
        Array.isArray(m.content) &&
        (m.content as OAIContentPart[]).some(p => p.type === 'image_url'),
    )
  }

  // The streaming create function
  async function createStream(
    params: Record<string, unknown>,
    requestOptions?: { signal?: AbortSignal; headers?: Record<string, string> },
  ) {
    const oaiRequest = buildOAIRequest(params)
    const url = `${baseURL}/chat/completions`

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      ...(options.defaultHeaders ?? {}),
      ...(requestOptions?.headers ?? {}),
    }

    // Add OpenRouter-specific headers if using OpenRouter
    if (baseURL.includes('openrouter')) {
      headers['HTTP-Referer'] = 'https://github.com/anthropics/claude-code'
      headers['X-Title'] = 'Claude Code'
    }

    let response: Response
    let actualRequest = oaiRequest
    try {
      response = await fetchWithRetry(
        url,
        {
          method: 'POST',
          headers,
          body: JSON.stringify(oaiRequest),
          signal: requestOptions?.signal,
        },
        maxRetries,
      )
    } catch (err) {
      // If the model doesn't support images, retry with images stripped
      if (isImageNotSupportedError(err) && requestHasImages(oaiRequest)) {
        // biome-ignore lint/suspicious/noConsole: intentional warning
        console.error(
          '[OpenAI Compat] Model does not support image input — retrying without images',
        )
        actualRequest = buildOAIRequest(params, true)
        response = await fetchWithRetry(
          url,
          {
            method: 'POST',
            headers,
            body: JSON.stringify(actualRequest),
            signal: requestOptions?.signal,
          },
          maxRetries,
        )
      } else {
        throw err
      }
    }

    const reader = response.body!.getReader()
    const state = createStreamState()
    const anthropicStream = convertStream(parseSSEStream(reader), state)

    // Build the stream object that mimics Anthropic SDK's Stream.
    // CRITICAL: `controller` must exist — claude.ts line 1854 uses
    // `'controller' in e.value` to distinguish stream objects from
    // error messages yielded by withRetry. Without it, the stream
    // is mistakenly treated as an error message and never consumed.
    const stream = {
      controller: new AbortController(),
      [Symbol.asyncIterator]() {
        return anthropicStream[Symbol.asyncIterator]()
      },
      // .withResponse() — return stream + metadata
      async withResponse() {
        return {
          data: stream,
          response,
          request_id:
            response.headers.get('x-request-id') ?? `req_${Date.now()}`,
        }
      },
    }

    return stream
  }

  // Non-streaming create function (fallback)
  async function createNonStreaming(
    params: Record<string, unknown>,
    requestOptions?: { signal?: AbortSignal; headers?: Record<string, string> },
  ) {
    const oaiRequest = buildOAIRequest(params)
    oaiRequest.stream = false
    delete oaiRequest.stream_options

    const url = `${baseURL}/chat/completions`

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      ...(options.defaultHeaders ?? {}),
      ...(requestOptions?.headers ?? {}),
    }

    if (baseURL.includes('openrouter')) {
      headers['HTTP-Referer'] = 'https://github.com/anthropics/claude-code'
      headers['X-Title'] = 'Claude Code'
    }

    let response: Response
    try {
      response = await fetchWithRetry(
        url,
        {
          method: 'POST',
          headers,
          body: JSON.stringify(oaiRequest),
          signal: requestOptions?.signal,
        },
        maxRetries,
      )
    } catch (err) {
      if (isImageNotSupportedError(err) && requestHasImages(oaiRequest)) {
        // biome-ignore lint/suspicious/noConsole: intentional warning
        console.error(
          '[OpenAI Compat] Model does not support image input — retrying without images',
        )
        const fallbackRequest = buildOAIRequest(params, true)
        fallbackRequest.stream = false
        delete fallbackRequest.stream_options
        response = await fetchWithRetry(
          url,
          {
            method: 'POST',
            headers,
            body: JSON.stringify(fallbackRequest),
            signal: requestOptions?.signal,
          },
          maxRetries,
        )
      } else {
        throw err
      }
    }

    const data = (await response.json()) as {
      id: string
      model: string
      choices: {
        message: {
          role: string
          content: string | null
          tool_calls?: OAIToolCall[]
        }
        finish_reason: string
      }[]
      usage?: { prompt_tokens: number; completion_tokens: number }
    }

    // Convert to Anthropic message format
    const choice = data.choices?.[0]
    const content: unknown[] = []

    if (choice?.message?.content) {
      content.push({ type: 'text', text: choice.message.content })
    }

    if (choice?.message?.tool_calls) {
      for (const tc of choice.message.tool_calls) {
        content.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.function.name,
          input: safeParseJSON(tc.function.arguments) ?? {},
        })
      }
    }

    return {
      id: data.id ?? `msg_${Date.now()}`,
      type: 'message',
      role: 'assistant',
      content,
      model: data.model ?? process.env.OPENAI_MODEL ?? 'unknown',
      stop_reason: mapFinishReason(choice?.finish_reason ?? 'stop'),
      stop_sequence: null,
      usage: {
        input_tokens: data.usage?.prompt_tokens ?? 0,
        output_tokens: data.usage?.completion_tokens ?? 0,
      },
    }
  }

  // Build the create function that handles both streaming and non-streaming
  function create(
    params: Record<string, unknown>,
    requestOptions?: { signal?: AbortSignal; headers?: Record<string, string> },
  ) {
    if (params.stream) {
      // Return a thenable that also has .withResponse()
      const promise = createStream(params, requestOptions)
      return {
        then: (
          resolve: (v: unknown) => void,
          reject: (e: unknown) => void,
        ) => promise.then(resolve, reject),
        withResponse: async () => {
          const stream = await promise
          return (stream as { withResponse: () => Promise<unknown> }).withResponse()
        },
      }
    }
    return createNonStreaming(params, requestOptions)
  }

  // Return the Anthropic-SDK-shaped object
  // The codebase calls: anthropic.beta.messages.create(...)
  return {
    beta: {
      messages: {
        create,
      },
    },
    messages: {
      create,
    },
  }
}

// ---------- Helpers ----------

function safeParseJSON(str: string): unknown {
  try {
    return JSON.parse(str)
  } catch {
    return null
  }
}
