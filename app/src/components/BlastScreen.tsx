import { useEffect, useRef, useState } from 'react'
import { ImageSquareIcon } from '@phosphor-icons/react'
import { imageExtension, MAX_IMAGE_BYTES } from '../blastShared'
import { AppButton } from './AppButton'
import { chrome } from './AppChrome'

interface Props {
  onBlasted: (slug: string) => void
  onBack?: () => void
}

export function BlastScreen({ onBlasted, onBack }: Props) {
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [keyReady, setKeyReady] = useState<boolean | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const requestRef = useRef(0)

  useEffect(() => {
    fetch('/__blast', { cache: 'no-store' })
      .then((response) => response.json())
      .then((payload: { ready?: boolean }) => setKeyReady(Boolean(payload.ready)))
      .catch(() => setKeyReady(null))
    return () => {
      requestRef.current += 1
    }
  }, [])

  useEffect(() => {
    if (!file) {
      setPreviewUrl(null)
      return
    }
    const url = URL.createObjectURL(file)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  const chooseFile = (next: File | null) => {
    if (!next) return
    const problem = fileProblem(next)
    setFile(problem ? null : next)
    setError(problem)
  }

  const blast = async () => {
    if (!file || running) return
    const problem = fileProblem(file)
    if (problem) {
      setError(problem)
      return
    }

    const requestId = ++requestRef.current
    setRunning(true)
    setError(null)
    try {
      const response = await fetch(`/__blast?name=${encodeURIComponent(file.name)}`, {
        method: 'POST',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: file,
      })
      const payload = await response.json().catch(() => null) as { error?: string, slug?: string } | null
      if (requestRef.current !== requestId) return
      if (!response.ok || !payload?.slug) {
        throw new Error(payload?.error || 'Blast failed.')
      }
      await onBlasted(payload.slug)
    } catch (blastError) {
      if (requestRef.current !== requestId) return
      setError(blastError instanceof Error ? blastError.message : 'Blast failed.')
    } finally {
      if (requestRef.current === requestId) setRunning(false)
    }
  }

  return (
    <div className="flex h-screen items-center justify-center bg-black px-4 text-white">
      <div className={`${chrome.panel} ${chrome.enter} flex w-full max-w-md flex-col gap-3 p-4 font-mono`}>
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm">image-blaster</span>
          {onBack && (
            <AppButton onClick={onBack} className="text-white" aria-label="Back to worlds">
              worlds
            </AppButton>
          )}
        </div>
        <p className="text-xs text-white/60">drop an image to generate the world</p>
        <label
          className={`flex min-h-52 cursor-pointer flex-col items-center justify-center gap-3 rounded border border-dashed px-4 py-6 text-center ${
            dragging ? 'border-white/70 bg-white/10' : 'border-white/20 bg-white/5'
          }`}
          onDragEnter={(event) => {
            event.preventDefault()
            setDragging(true)
          }}
          onDragOver={(event) => {
            event.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault()
            setDragging(false)
            chooseFile(event.dataTransfer.files[0] ?? null)
          }}
        >
          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,image/avif,image/heic,image/heif,.png,.jpg,.jpeg,.webp,.gif,.avif,.heic,.heif"
            className="sr-only"
            onChange={(event) => {
              chooseFile(event.target.files?.[0] ?? null)
              event.target.value = ''
            }}
          />
          {previewUrl ? (
            <img src={previewUrl} alt="" className="max-h-56 w-full rounded object-contain" />
          ) : (
            <>
              <ImageSquareIcon size={28} weight="regular" className="text-white/50" />
              <span className="text-sm text-white/80">choose an image</span>
            </>
          )}
        </label>
        <div className="flex items-center justify-between gap-3">
          <span className="min-w-0 flex-1 truncate text-xs text-white/50">{file?.name ?? 'png, jpg, webp'}</span>
          <AppButton
            onClick={() => void blast()}
            disabled={!file || running}
            className="justify-center border border-white/20 px-3 text-white disabled:pointer-events-none disabled:opacity-40"
          >
            {running ? 'blasting' : 'blast'}
          </AppButton>
        </div>
        {running && (
          <p className="text-xs text-white/70">generating world… this can take a few minutes</p>
        )}
        {error && <p className="text-xs text-orange-200">{error}</p>}
        {keyReady === false && !error && (
          <p className="text-xs text-white/55">
            add WORLD_LABS_API_KEY to .env. create one at platform.worldlabs.ai
          </p>
        )}
      </div>
    </div>
  )
}

function fileProblem(file: File) {
  if (!imageExtension(file.name, file.type)) return 'Use a png, jpg, webp, gif, avif, or heic image.'
  if (file.size > MAX_IMAGE_BYTES) return 'Image is too large.'
  if (!file.size) return 'Choose an image first.'
  return null
}
