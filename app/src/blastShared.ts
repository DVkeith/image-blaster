export const MAX_IMAGE_BYTES = 20 * 1024 * 1024

const EXTENSIONS = new Map<string, string>([
  ['.png', '.png'],
  ['.jpg', '.jpg'],
  ['.jpeg', '.jpg'],
  ['.webp', '.webp'],
  ['.gif', '.gif'],
  ['.avif', '.avif'],
  ['.heic', '.heic'],
  ['.heif', '.heif'],
])

const CONTENT_TYPES = new Map<string, string>([
  ['image/png', '.png'],
  ['image/jpeg', '.jpg'],
  ['image/jpg', '.jpg'],
  ['image/webp', '.webp'],
  ['image/gif', '.gif'],
  ['image/avif', '.avif'],
  ['image/heic', '.heic'],
  ['image/heif', '.heif'],
])

export function slugify(value: string) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

export function imageExtension(filename: string, contentType?: string) {
  const fromName = EXTENSIONS.get(extensionOf(filename))
  if (fromName) return fromName
  if (!contentType) return null
  return CONTENT_TYPES.get(contentType.split(';')[0].trim().toLowerCase()) ?? null
}

export function slugFromFilename(filename: string) {
  const stem = filename.replace(/\.[^.]+$/, '').replace(/^\d+-/, '')
  return slugify(stem) || 'image'
}

function extensionOf(filename: string) {
  const match = /\.[^.]+$/.exec(filename)
  return match ? match[0].toLowerCase() : ''
}
