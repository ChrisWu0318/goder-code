import { execSync } from 'child_process'
import { join, basename, extname } from 'path'
import { existsSync, statSync } from 'fs'
import type { LocalCommandResult } from '../../types/command.js'

// Supported preview formats (yazi handles these via poppler, chafa, ffmpeg, etc.)
const IMAGE_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.svg',
  '.tiff', '.tif', '.ico', '.heic', '.avif',
])
const DOC_EXTS = new Set([
  '.pdf', '.docx', '.pptx', '.xlsx',
])
const MEDIA_EXTS = new Set([
  '.mp4', '.mkv', '.avi', '.mov', '.webm',
  '.mp3', '.flac', '.wav',
])

export async function call(
  args: string,
): Promise<LocalCommandResult> {
  const trimmed = args.trim()

  if (!trimmed) {
    return {
      type: 'text',
      value: `Usage: /preview <file_path>

Opens yazi with the file pre-selected for instant preview.
Supported: PDF, DOCX, images, video thumbnails, text, and more.

In Ghostty, preview uses the Kitty Graphics Protocol for
high-quality inline rendering.

Example: /preview docs/report.pdf`,
    }
  }

  // Resolve relative paths
  let filepath = trimmed
  if (!filepath.startsWith('/') && !filepath.startsWith('~')) {
    filepath = join(process.cwd(), filepath)
  }

  if (!existsSync(filepath)) {
    return { type: 'text', value: `File not found: ${filepath}` }
  }

  const stats = statSync(filepath)
  if (stats.isDirectory()) {
    // Navigate to directory instead
    try {
      execSync(`yazi "${filepath}"`, { stdio: 'inherit' })
    } catch {
      return { type: 'text', value: `yazi exited. Back in ${filepath}` }
    }
    return { type: 'skip' }
  }

  const ext = extname(filepath).toLowerCase()
  const size = stats.size

  // Build file info line
  let typeLabel = 'file'
  if (IMAGE_EXTS.has(ext)) typeLabel = 'image'
  else if (DOC_EXTS.has(ext)) typeLabel = 'document'
  else if (MEDIA_EXTS.has(ext)) typeLabel = 'media'

  const formattedSize = formatBytes(size)

  try {
    // Launch yazi with the file pre-selected.
    // { stdio: 'inherit' } passes through stdin/stdout/stderr directly,
    // so yazi's TUI takes over the terminal until the user presses `q`.
    execSync(`yazi "${filepath}"`, { stdio: 'inherit' })
  } catch {
    // User exited yazi — no error, just return to Goder
  }

  // After user quits yazi, don't display anything (just return to work)
  return { type: 'skip' }
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${bytes} B`
}
