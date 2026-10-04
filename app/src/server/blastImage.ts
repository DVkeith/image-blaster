import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { imageExtension, MAX_IMAGE_BYTES, slugFromFilename } from '../blastShared.ts'

const WORLD_GENERATION_TIMEOUT_MS = 20 * 60 * 1000
const PLACEHOLDER_KEYS = new Set([
  'your_world_labs_key_here',
  'your_fal_key_here',
  'changeme',
  'CHANGE_ME',
  'TODO',
  'todo',
])

export type RunCommand = (args: string[], cwd: string) => Promise<string>

export function usableEnvValue(name: string, env: NodeJS.ProcessEnv, envText = '') {
  const fromProcess = env[name]?.trim()
  const raw = fromProcess || valueFromEnvFile(envText, name)
  if (!raw || PLACEHOLDER_KEYS.has(raw)) return undefined
  return raw
}

export async function worldLabsReady(repoRoot: string, env: NodeJS.ProcessEnv = process.env) {
  const envText = await readFile(path.join(repoRoot, '.env'), 'utf8').catch(() => '')
  return Boolean(usableEnvValue('WORLD_LABS_API_KEY', env, envText))
}

export async function nextWorldSlug(worldsDir: string, base: string) {
  const root = base || 'image'
  let candidate = root
  let suffix = 2
  while (await pathExists(path.join(worldsDir, candidate))) {
    candidate = `${root}-${suffix}`
    suffix += 1
  }
  return candidate
}

export async function blastImage({
  filename,
  bytes,
  contentType,
  repoRoot,
  run = runNodeScript,
  env = process.env,
}: {
  filename: string
  bytes: Buffer
  contentType?: string
  repoRoot: string
  run?: RunCommand
  env?: NodeJS.ProcessEnv
}) {
  if (!bytes.byteLength) throw new Error('Choose an image first.')
  if (bytes.byteLength > MAX_IMAGE_BYTES) throw new Error('Image is too large.')

  const extension = imageExtension(filename, contentType)
  if (!extension) throw new Error('Use a png, jpg, webp, gif, avif, or heic image.')

  const envText = await readFile(path.join(repoRoot, '.env'), 'utf8').catch(() => '')
  if (!usableEnvValue('WORLD_LABS_API_KEY', env, envText)) {
    throw new Error('WORLD_LABS_API_KEY is not set. Add it to .env before blasting an image.')
  }

  const slug = await nextWorldSlug(path.join(repoRoot, 'worlds'), slugFromFilename(filename))
  const stagingDir = await mkdtemp(path.join(os.tmpdir(), 'image-blast-'))
  try {
    await writeFile(path.join(stagingDir, `0-${slug}${extension}`), bytes)
    const stateJson = await run([
      'node',
      '.claude/scripts/project/project-state.mjs',
      '--world',
      slug,
      '--stage-input',
      '--input-dir',
      stagingDir,
    ], repoRoot)
    const state = JSON.parse(stateJson) as { staged_files?: Array<{ to?: string }> }
    const stagedPath = state.staged_files?.find((file) => file.to)?.to
    if (!stagedPath) throw new Error('Could not stage the image.')

    const imagePath = path.isAbsolute(stagedPath) ? path.relative(repoRoot, stagedPath) : stagedPath
    await run([
      'node',
      '.claude/scripts/world/generate-world.mjs',
      '--world',
      slug,
      '--image',
      imagePath,
    ], repoRoot)

    return { slug, route: `/${slug}` }
  } finally {
    await rm(stagingDir, { recursive: true, force: true })
  }
}

export function runNodeScript(args: string[], cwd: string) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(args[0], args.slice(1), {
      cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      callback()
    }
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      finish(() => reject(new Error('World generation timed out.')))
    }, WORLD_GENERATION_TIMEOUT_MS)

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
    })
    child.on('error', (error) => {
      finish(() => reject(error))
    })
    child.on('close', (code) => {
      finish(() => {
        if (code === 0) resolve(stdout)
        else reject(new Error(stderr.trim() || stdout.trim() || `Command failed (${code}).`))
      })
    })
  })
}

function valueFromEnvFile(envText: string, name: string) {
  for (const rawLine of envText.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#') || !line.startsWith(`${name}=`)) continue
    let value = line.slice(name.length + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    return value.trim()
  }
  return undefined
}

async function pathExists(filePath: string) {
  try {
    await stat(filePath)
    return true
  } catch {
    return false
  }
}
