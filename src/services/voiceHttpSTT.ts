// Goder: HTTP-based speech-to-text using Groq or OpenAI Whisper API.
//
// Drop-in replacement for the Anthropic voice_stream WebSocket when the user
// doesn't have Anthropic OAuth. Implements the same VoiceStreamConnection
// interface so useVoice.ts needs zero changes.
//
// Audio chunks are buffered during recording. On finalize(), they're
// concatenated into a WAV file and POSTed to the provider's
// /v1/audio/transcriptions endpoint. No streaming — one request, one response.

import { logForDebugging } from '../utils/debug.js'
import { logError } from '../utils/log.js'
import type {
  FinalizeSource,
  VoiceStreamCallbacks,
  VoiceStreamConnection,
} from './voiceStreamSTT.js'

// ─── Provider detection ──────────────────────────────────────────────

export type STTProvider = {
  name: string
  apiKey: string
  baseUrl: string
  model: string
}

export function getSTTProvider(): STTProvider | null {
  // Priority 1: Explicit Goder STT config
  if (process.env.GODER_STT_API_KEY) {
    return {
      name: process.env.GODER_STT_PROVIDER ?? 'groq',
      apiKey: process.env.GODER_STT_API_KEY,
      baseUrl:
        process.env.GODER_STT_BASE_URL ??
        (process.env.GODER_STT_PROVIDER === 'openai'
          ? 'https://api.openai.com'
          : 'https://api.groq.com/openai'),
      model:
        process.env.GODER_STT_MODEL ??
        (process.env.GODER_STT_PROVIDER === 'openai'
          ? 'whisper-1'
          : 'whisper-large-v3-turbo'),
    }
  }

  // Priority 2: Groq API key
  if (process.env.GROQ_API_KEY) {
    return {
      name: 'groq',
      apiKey: process.env.GROQ_API_KEY,
      baseUrl: 'https://api.groq.com/openai',
      model: process.env.GODER_STT_MODEL ?? 'whisper-large-v3-turbo',
    }
  }

  // Priority 3: OpenAI API key (only if NOT using OpenRouter)
  if (
    process.env.OPENAI_API_KEY &&
    !process.env.CLAUDE_CODE_USE_OPENAI_COMPAT
  ) {
    return {
      name: 'openai',
      apiKey: process.env.OPENAI_API_KEY,
      baseUrl: 'https://api.openai.com',
      model: process.env.GODER_STT_MODEL ?? 'whisper-1',
    }
  }

  return null
}

export function isHttpSTTAvailable(): boolean {
  return getSTTProvider() !== null
}

// ─── WAV encoding ───────────────────────────────────────────────────

function pcmToWav(
  pcm: Buffer,
  sampleRate = 16_000,
  channels = 1,
  bitDepth = 16,
): Buffer {
  const dataSize = pcm.length
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + dataSize, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20) // PCM format
  header.writeUInt16LE(channels, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE((sampleRate * channels * bitDepth) / 8, 28)
  header.writeUInt16LE((channels * bitDepth) / 8, 32)
  header.writeUInt16LE(bitDepth, 34)
  header.write('data', 36)
  header.writeUInt32LE(dataSize, 40)
  return Buffer.concat([header, pcm])
}

// ─── HTTP STT connection ────────────────────────────────────────────

export async function connectHttpSTT(
  callbacks: VoiceStreamCallbacks,
  options?: { language?: string },
): Promise<VoiceStreamConnection | null> {
  const provider = getSTTProvider()
  if (!provider) {
    logForDebugging('[voice_http] No STT provider configured')
    return null
  }

  logForDebugging(
    `[voice_http] Using ${provider.name} (model: ${provider.model})`,
  )

  const audioChunks: Buffer[] = []
  let finalized = false
  let closed = false

  const connection: VoiceStreamConnection = {
    send(audioChunk: Buffer): void {
      if (finalized || closed) return
      audioChunks.push(Buffer.from(audioChunk))
    },

    async finalize(): Promise<FinalizeSource> {
      if (finalized) return 'ws_already_closed'
      finalized = true

      if (audioChunks.length === 0) {
        logForDebugging('[voice_http] No audio data to transcribe')
        return 'no_data_timeout'
      }

      const pcm = Buffer.concat(audioChunks)
      const wav = pcmToWav(pcm)
      logForDebugging(
        `[voice_http] Transcribing ${audioChunks.length} chunks (${pcm.length} bytes PCM → ${wav.length} bytes WAV)`,
      )

      try {
        const formData = new FormData()
        const blob = new Blob([wav], { type: 'audio/wav' })
        formData.append('file', blob, 'recording.wav')
        formData.append('model', provider.model)
        if (options?.language) {
          formData.append('language', options.language)
        }

        const url = `${provider.baseUrl}/v1/audio/transcriptions`
        logForDebugging(`[voice_http] POST ${url}`)

        const response = await fetch(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${provider.apiKey}`,
          },
          body: formData,
        })

        if (!response.ok) {
          const errorText = await response.text().catch(() => 'unknown error')
          const msg = `STT API error: HTTP ${response.status} — ${errorText}`
          logForDebugging(`[voice_http] ${msg}`)
          callbacks.onError(msg)
          return 'safety_timeout'
        }

        const result = (await response.json()) as { text?: string }
        const transcript = result.text?.trim() ?? ''

        logForDebugging(
          `[voice_http] Transcript (${transcript.length} chars): "${transcript.slice(0, 200)}"`,
        )

        if (transcript) {
          callbacks.onTranscript(transcript, true)
        }

        return 'post_closestream_endpoint'
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : 'Unknown transcription error'
        logError(err instanceof Error ? err : new Error(msg))
        logForDebugging(`[voice_http] Transcription failed: ${msg}`)
        callbacks.onError(`Transcription failed: ${msg}`)
        return 'safety_timeout'
      }
    },

    close(): void {
      closed = true
      audioChunks.length = 0
    },

    isConnected(): boolean {
      return !closed && !finalized
    },
  }

  // Fire onReady immediately — no connection setup needed for HTTP
  // This must be async (next tick) to match the WebSocket onReady timing
  // that useVoice.ts expects.
  setTimeout(() => {
    if (!closed) {
      callbacks.onReady(connection)
    }
  }, 0)

  return connection
}
