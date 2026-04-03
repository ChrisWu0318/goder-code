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
    // Try PNG data first, then TIFF, then file references (furl)
    const { stdout } = await execAsync(
      `osascript -e '
        use framework "AppKit"
        use framework "Foundation"
        set pb to current application's NSPasteboard's generalPasteboard()
        set posixPath to POSIX path of "${filepath}"

        -- Try raw PNG data
        set pngData to pb's dataForType:(current application's NSPasteboardTypePNG)
        if pngData is missing value then
          set pngData to pb's dataForType:(current application's NSPasteboardTypeTIFF)
        end if

        if pngData is not missing value then
          pngData's writeToFile:posixPath atomically:true
          return "saved"
        end if

        -- Handle file references (dragged from Finder)
        set filePaths to pb's readObjectsForClasses:{current application's NSURL} options:(missing value)
        if filePaths is not missing value and (filePaths's |count|()) > 0 then
          set fileURL to (filePaths's objectAtIndex:0)
          -- Copy the referenced image file to our path
          set sourcePath to fileURL's |path|()
          set fileManager to current application's NSFileManager's defaultManager()
          set {theResult, theError} to fileManager's copyItemAtPath:sourcePath toPath:posixPath |error|:(reference)
          if theResult then
            return "saved"
          end if
        end if

        return "no_image"
      '`
    )

    if (!stdout.trim().includes('saved')) {
      return null
    }

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
        use framework "Foundation"
        set pb to current application's NSPasteboard's generalPasteboard()

        set data to pb's dataForType:(current application's NSPasteboardTypePNG)
        if data is missing value then
          set data to pb's dataForType:(current application's NSPasteboardTypeTIFF)
        end if

        if data is not missing value then
          set hex to data's base64EncodedStringWithOptions:0
          return "data:" & hex
        end if

        -- File reference: hash the file path as fingerprint
        set filePaths to pb's readObjectsForClasses:{current application's NSURL} options:(missing value)
        if filePaths is not missing value and (filePaths's |count|()) > 0 then
          set fileURL to (filePaths's objectAtIndex:0)
          return "file:" & (fileURL's |path|() as text)
        end if

        return "none"
      '`
    )
    const trimmed = stdout.trim()
    if (trimmed && trimmed !== 'none') {
      const crypto = await import('crypto')
      return crypto.createHash('md5').update(trimmed).digest('hex')
    }
    return null
  } catch {
    return null
  }
}

interface WatchModeOptions {
  maxImages?: number
  timeoutMs?: number | null  // null = no timeout, only Ctrl+C
}

async function watchMode({ maxImages = 10, timeoutMs = null }: WatchModeOptions = {}): Promise<{ images: ClipImage[]; count: number; timedOut: boolean }> {
  mkdirSync(CLIPBOARD_DIR, { recursive: true })

  let lastIndex = findLastImageIndex() + 1
  let lastMd5 = await getClipboardImageMd5()
  const images: ClipImage[] = []

  const POLL_MS = 500

  return new Promise((resolve) => {
    const startTime = Date.now()

    const poll = async () => {
      // Exit conditions: ctrl+c (SIGINT handled elsewhere), max images reached, or timeout elapsed
      if (images.length >= maxImages) {
        resolve({ images, count: lastIndex, timedOut: false })
        return
      }
      if (timeoutMs !== null && Date.now() - startTime > timeoutMs) {
        resolve({ images, count: lastIndex, timedOut: true })
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

// Parse args like "--watch" or "--count 5" or "--timeout 30" or "--max 20"
function parseArgs(args: string): { mode: 'single' | 'watch' | 'batch'; count: number; timeoutMs: number | null; maxImages: number } {
  if (args.includes('--watch') || args.includes('-w')) {
    const timeoutMatch = args.match(/--timeout\s+(\d+)/)
    const maxMatch = args.match(/--max\s+(\d+)/)
    const timeoutMs = timeoutMatch ? parseInt(timeoutMatch[1], 10) * 1000 : null // seconds, null = no timeout
    const maxImages = maxMatch ? parseInt(maxMatch[1], 10) : 10
    return { mode: 'watch', count: 10, timeoutMs, maxImages }
  }
  const countMatch = args.match(/--count\s+(\d+)|-c\s+(\d+)/)
  if (countMatch) {
    return { mode: 'batch', count: parseInt(countMatch[1] || countMatch[2], 10), timeoutMs: null, maxImages: 10 }
  }
  return { mode: 'single', count: 1, timeoutMs: null, maxImages: 10 }
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
  const { mode, count, timeoutMs, maxImages } = parseArgs(args)

  if (mode === 'watch') {
    const { images, timedOut } = await watchMode({ maxImages, timeoutMs })
    if (images.length === 0) {
      return { type: 'text', value: timedOut
        ? `Watch mode timed out after ${(timeoutMs! / 1000)}s. No images captured.`
        : 'Watch mode complete. No images captured.' }
    }
    const pathList = images.map(img => img.path).join('\n')
    return {
      type: 'text',
      shouldQuery: true,
      value: `Captured ${images.length} image(s) from clipboard:\n${pathList}\n\nRead these files to view the images.`,
    }
  }

  if (mode === 'batch') {
    const images = await batchMode(count)
    if (images.length === 0) {
      return { type: 'text', value: 'No images found in clipboard.' }
    }
    const pathList = images.map(img => img.path).join('\n')
    return {
      type: 'text',
      shouldQuery: true,
      value: `Grabbed ${images.length} image(s) from clipboard:\n${pathList}\n\nRead these files to view the images.`,
    }
  }

  // Single grab
  const img = await singleGrab()
  if (!img) {
    return { type: 'text', value: 'No image found in clipboard.' }
  }

  return {
    type: 'text',
    shouldQuery: true,
    value: `Clipboard image saved to ${img.path}\n\nRead this file to view the image.`,
  }
}
