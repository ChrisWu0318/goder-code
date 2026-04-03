import type { LocalJSXCommandContext } from '../../types/command.js'
import type { LocalCommandResult } from '../../types/command.js'
import { Box, Text } from '../../ink.js'
import { exec } from 'child_process'
import { promisify } from 'util'
import { join } from 'path'
import { tmpdir } from 'os'
import { mkdirSync, readdirSync } from 'fs'

const execAsync = promisify(exec)

const CLIPBOARD_DIR = join(tmpdir(), 'claude-clipboard')

interface ClipImage {
  filename: string
  path: string
  size: number
}

async function grabClipboardImage(idx: number): Promise<string | null> {
  const filename = `img_${String(idx).padStart(3, '0')}.png`
  const filepath = join(CLIPBOARD_DIR, filename)

  try {
    await execAsync(
      `osascript -e '
        use framework "AppKit"
        use framework "Foundation"
        set pb to current application's NSPasteboard's generalPasteboard()
        set pngData to pb's dataForType:(current application's NSPasteboardTypePNG)
        if pngData is missing value then
          set pngData to pb's dataForType:(current application's NSPasteboardTypeTIFF)
        end if
        if pngData is not missing value then
          set posixPath to POSIX path of "${filepath}"
          pngData's writeToFile:posixPath atomically:true
        else
          error "No image"
        end if
      '`
    )

    // Verify the file was created
    const fs = await import('fs/promises')
    const stat = await fs.stat(filepath)
    if (stat.size > 0) {
      return filepath
    }
    return null
  } catch {
    return null
  }
}

async function getClipboardImageMd5(): Promise<string | null> {
  try {
    const { stdout } = await execAsync(
      `osascript -e '
        use framework "AppKit"
        set pb to current application's NSPasteboard's generalPasteboard()
        set data to pb's dataForType:(current application's NSPasteboardTypePNG)
        if data is missing value then
          set data to pb's dataForType:(current application's NSPasteboardTypeTIFF)
        end if
        if data is not missing value then
          set hex to data's base64EncodedStringWithOptions:0
          return hex
        else
          return ""
        end if
      '`
    )
    const hex = stdout.trim()
    if (hex) {
      const crypto = await import('crypto')
      return crypto.createHash('md5').update(hex).digest('hex')
    }
    return null
  } catch {
    return null
  }
}

async function watchMode(): Promise<{ images: ClipImage[]; count: number }> {
  mkdirSync(CLIPBOARD_DIR, { recursive: true })

  let lastIndex = findLastImageIndex() + 1
  let lastMd5 = await getClipboardImageMd5()
  const images: ClipImage[] = []

  // Return after 60s or after 10 new images, whichever comes first
  const MAX_IMAGES = 10
  const TIMEOUT_MS = 60000
  const POLL_MS = 1500

  return new Promise((resolve) => {
    const startTime = Date.now()

    const poll = async () => {
      if (Date.now() - startTime > TIMEOUT_MS || images.length >= MAX_IMAGES) {
        resolve({ images, count: lastIndex })
        return
      }

      const currentMd5 = await getClipboardImageMd5()
      if (currentMd5 && currentMd5 !== lastMd5) {
        const path = await grabClipboardImage(lastIndex)
        if (path) {
          const fs = await import('fs/promises')
          const stat = await fs.stat(path)
          images.push({
            filename: `img_${String(lastIndex).padStart(3, '0')}.png`,
            path,
            size: stat.size,
          })
          lastIndex++
          lastMd5 = currentMd5
        }
      }

      setTimeout(poll, POLL_MS)
    }

    poll()
  })
}

function findLastImageIndex(): number {
  try {
    const files = readdirSync(CLIPBOARD_DIR)
    const pngFiles = files.filter(f => f.startsWith('img_') && f.endsWith('.png'))
    if (pngFiles.length === 0) return 0
    // Extract number from img_001.png
    const nums = pngFiles.map(f => {
      const m = f.match(/img_(\d+)\.png/)
      return m ? parseInt(m[1], 10) : 0
    })
    return Math.max(...nums)
  } catch {
    return 0
  }
}

async function batchMode(count: number): Promise<ClipImage[]> {
  mkdirSync(CLIPBOARD_DIR, { recursive: true })
  const images: ClipImage[] = []
  let idx = findLastImageIndex() + 1

  for (let i = 0; i < count; i++) {
    const path = await grabClipboardImage(idx)
    if (path) {
      const fs = await import('fs/promises')
      const stat = await fs.stat(path)
      const filename = `img_${String(idx).padStart(3, '0')}.png`
      images.push({ filename, path, size: stat.size })
    }
    idx++
  }

  return images
}

async function singleGrab(): Promise<ClipImage | null> {
  mkdirSync(CLIPBOARD_DIR, { recursive: true })
  const idx = findLastImageIndex() + 1
  const path = await grabClipboardImage(idx)
  if (path) {
    const fs = await import('fs/promises')
    const stat = await fs.stat(path)
    const filename = `img_${String(idx).padStart(3, '0')}.png`
    return { filename, path, size: stat.size }
  }
  return null
}

// Parse args like "--watch" or "--count 5"
function parseArgs(args: string): { mode: 'single' | 'watch' | 'batch'; count: number } {
  if (args.includes('--watch') || args.includes('-w')) {
    return { mode: 'watch', count: 10 }
  }
  const countMatch = args.match(/--count\s+(\d+)|-c\s+(\d+)/)
  if (countMatch) {
    return { mode: 'batch', count: parseInt(countMatch[1] || countMatch[2], 10) }
  }
  return { mode: 'single', count: 1 }
}

// React component for watch mode display
function WatchDisplay({ images }: { images: ClipImage[] }) {
  return (
    <Box flexDirection="column" gap={1}>
      <Text bold>{images.length} images grabbed:</Text>
      {images.map(img => (
        <Text key={img.filename} dimColor>
          {img.filename} ({(img.size / 1024).toFixed(1)} KB)
        </Text>
      ))}
      <Text dimColor>
        All images saved to {CLIPBOARD_DIR}/
      </Text>
      <Text dimColor>
        To view: /read {CLIPBOARD_DIR}/img_001.png
      </Text>
    </Box>
  )
}

export const call = async (
  args: string,
  context: LocalJSXCommandContext,
): Promise<LocalCommandResult> => {
  const { mode, count } = parseArgs(args)

  if (mode === 'watch') {
    const { images } = await watchMode()
    return {
      type: 'text',
      value: `Watch mode complete. ${images.length} image(s) saved to ${CLIPBOARD_DIR}/`,
    }
  }

  if (mode === 'batch') {
    const images = await batchMode(count)
    if (images.length === 0) {
      return { type: 'text', value: 'No images found in clipboard.' }
    }
    return {
      type: 'text',
      value: `Grabbed ${images.length} image(s):\n${images
        .map(img => `${img.filename} (${(img.size / 1024).toFixed(1)} KB) — ${img.path}`)
        .join('\n')}\n\nTo view, use: /read ${images[0].path}`,
    }
  }

  // Single grab
  const img = await singleGrab()
  if (!img) {
    return { type: 'text', value: 'No image found in clipboard.' }
  }

  return {
    type: 'text',
    value: `Image saved:\n${img.filename} (${(img.size / 1024).toFixed(1)} KB) — ${img.path}\n\nTo view, I can read: /read ${img.path}`,
  }
}
