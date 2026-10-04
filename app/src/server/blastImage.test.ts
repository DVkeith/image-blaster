import { mkdtemp, mkdir, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { blastImage, nextWorldSlug, runNodeScript, usableEnvValue, type RunCommand } from './blastImage.ts'

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('blastImage', () => {
  it('rejects placeholder and missing world labs keys', () => {
    expect(usableEnvValue('WORLD_LABS_API_KEY', {}, 'WORLD_LABS_API_KEY=your_world_labs_key_here')).toBeUndefined()
    expect(usableEnvValue('WORLD_LABS_API_KEY', { WORLD_LABS_API_KEY: 'real-key' }, '')).toBe('real-key')
  })

  it('stages the image and runs world generation', async () => {
    const repoRoot = await makeRepo()
    const calls: string[][] = []
    const run: RunCommand = async (args) => {
      calls.push(args)
      if (args[1].endsWith('project-state.mjs')) {
        const slug = args[args.indexOf('--world') + 1]
        return JSON.stringify({
          staged_files: [{ to: `worlds/${slug}/source/0-${slug}.png` }],
        })
      }
      return JSON.stringify({ world: args[args.indexOf('--world') + 1] })
    }

    const result = await blastImage({
      filename: 'My Photo.PNG',
      bytes: PNG,
      contentType: 'image/png',
      repoRoot,
      env: { WORLD_LABS_API_KEY: 'real-key' },
      run,
    })

    expect(result).toEqual({ slug: 'my-photo', route: '/my-photo' })
    expect(calls[0]).toEqual([
      'node',
      '.claude/scripts/project/project-state.mjs',
      '--world',
      'my-photo',
      '--stage-input',
      '--input-dir',
      expect.stringMatching(/image-blast-/),
    ])
    expect(calls[1]).toEqual([
      'node',
      '.claude/scripts/world/generate-world.mjs',
      '--world',
      'my-photo',
      '--image',
      'worlds/my-photo/source/0-my-photo.png',
    ])
  })

  it('uses the real project staging script and passes that image to world generation', async () => {
    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
    const slugPrefix = `blast-test-${Date.now()}`
    const calls: string[][] = []
    let slug = ''
    try {
      const result = await blastImage({
        filename: `${slugPrefix}.png`,
        bytes: PNG,
        contentType: 'image/png',
        repoRoot,
        env: { WORLD_LABS_API_KEY: 'real-key' },
        run: async (args, cwd) => {
          calls.push(args)
          if (args[1].endsWith('project-state.mjs')) return runNodeScript(args, cwd)
          slug = args[args.indexOf('--world') + 1]
          return JSON.stringify({ skipped: true })
        },
      })

      expect(result.slug).toBe(slugPrefix)
      expect(calls[1][calls[1].indexOf('--image') + 1]).toBe(`worlds/${slugPrefix}/source/0-${slugPrefix}.png`)
      await expect(statSafe(path.join(repoRoot, 'worlds', result.slug, 'project.json'))).resolves.toBe(true)
      await expect(statSafe(path.join(repoRoot, 'worlds', result.slug, 'source', `0-${slugPrefix}.png`))).resolves.toBe(true)
    } finally {
      if (slug || slugPrefix) {
        await rm(path.join(repoRoot, 'worlds', slug || slugPrefix), { recursive: true, force: true })
      }
    }
  })

  it('does not start generation without a key or for a non-image', async () => {
    const repoRoot = await makeRepo()
    await writeFile(path.join(repoRoot, '.env'), 'WORLD_LABS_API_KEY=your_world_labs_key_here\n')
    const run: RunCommand = async () => {
      throw new Error('should not run')
    }

    await expect(blastImage({
      filename: 'room.png',
      bytes: PNG,
      repoRoot,
      env: {},
      run,
    })).rejects.toThrow(/WORLD_LABS_API_KEY/)

    await expect(blastImage({
      filename: 'notes.txt',
      bytes: Buffer.from('hello'),
      contentType: 'text/plain',
      repoRoot,
      env: { WORLD_LABS_API_KEY: 'real-key' },
      run,
    })).rejects.toThrow(/png, jpg, webp/)
  })

  it('avoids an existing world directory', async () => {
    const repoRoot = await makeRepo()
    await mkdir(path.join(repoRoot, 'worlds', 'room'), { recursive: true })
    await mkdir(path.join(repoRoot, 'worlds', 'room-2'), { recursive: true })
    await expect(nextWorldSlug(path.join(repoRoot, 'worlds'), 'room')).resolves.toBe('room-3')
  })
})

async function makeRepo() {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'blast-repo-'))
  tempDirs.push(repoRoot)
  await mkdir(path.join(repoRoot, 'worlds'), { recursive: true })
  await writeFile(path.join(repoRoot, '.env'), 'WORLD_LABS_API_KEY=real-key\n')
  return repoRoot
}

async function statSafe(filePath: string) {
  try {
    const info = await stat(filePath)
    return info.isFile()
  } catch {
    return false
  }
}
