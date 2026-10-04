import { useEffect, useRef, useState } from 'react'

interface Props {
  /** screenshot candidates in preference order (primary, then review alternates) */
  srcs: string[]
  /** which candidate to try first (persisted rotation: next round => next shot) */
  startAt: number
  /** pixel grid size, 0 = full resolution */
  resolution: number
  seed: string
}

const W = 640
const H = 360

/** Deterministic hue from a string, for the dev placeholder when no screenshot exists yet. */
function hueFor(seed: string): number {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360
  return h
}

function drawLoading(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = '#12101f'
  ctx.fillRect(0, 0, W, H)
  ctx.fillStyle = 'rgba(255,255,255,0.7)'
  ctx.font = 'bold 22px sans-serif'
  ctx.fillText('LOADING…', 24, 40)
}

function drawPlaceholder(ctx: CanvasRenderingContext2D, seed: string) {
  const hue = hueFor(seed)
  const grad = ctx.createLinearGradient(0, 0, W, H)
  grad.addColorStop(0, `hsl(${hue}, 60%, 35%)`)
  grad.addColorStop(1, `hsl(${(hue + 60) % 360}, 60%, 25%)`)
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, W, H)
  // some fake "scene" blocks so pixelation still looks interesting
  ctx.fillStyle = `hsl(${(hue + 180) % 360}, 70%, 55%)`
  ctx.fillRect(W * 0.1, H * 0.55, W * 0.25, H * 0.3)
  ctx.fillStyle = `hsl(${(hue + 120) % 360}, 65%, 50%)`
  ctx.fillRect(W * 0.55, H * 0.2, W * 0.35, H * 0.45)
  ctx.fillStyle = 'rgba(255,255,255,0.85)'
  ctx.font = 'bold 22px sans-serif'
  ctx.fillText('NO SCREENSHOT YET', 24, 40)
  ctx.font = '15px sans-serif'
  ctx.fillText('run npm run fetch:screenshots', 24, 64)
}

/**
 * Renders an image pixelated: downscale to `resolution`x`resolution`
 * then upscale with smoothing off. `resolution === 0` draws full quality.
 * Candidates are tried in rotation order starting at `startAt`, wrapping
 * around — a deleted file falls through to the next screenshot, then to
 * the placeholder. Each candidate gets one delayed retry so a transient
 * CDN hiccup doesn't burn through good shots to the placeholder.
 */
export default function PixelCanvas({ srcs, startAt, resolution, seed }: Props) {
  const ref = useRef<HTMLCanvasElement>(null)
  const [skip, setSkip] = useState(0)
  const [retryTick, setRetryTick] = useState(0)
  const retried = useRef(new Set<number>())
  const key = `${srcs.join('|')}@${startAt}@${resolution}`
  useEffect(() => {
    setSkip(0)
    setRetryTick(0)
    retried.current = new Set()
  }, [key, startAt])

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.imageSmoothingEnabled = resolution === 0

    if (skip >= srcs.length) {
      drawPlaceholder(ctx, seed)
      return
    }
    const idx = (startAt + skip) % srcs.length
    const src = srcs[idx]
    drawLoading(ctx)

    let timer: ReturnType<typeof setTimeout> | undefined
    const onError = () => {
      if (!retried.current.has(idx)) {
        retried.current.add(idx)
        timer = setTimeout(() => setRetryTick((t) => t + 1), 1200)
      } else {
        setSkip((s) => s + 1)
      }
    }

    if (resolution === 0) {
      const img = new Image()
      img.src = src
      img.onload = () => {
        ctx.imageSmoothingEnabled = true
        ctx.clearRect(0, 0, W, H)
        ctx.drawImage(img, 0, 0, W, H)
      }
      img.onerror = onError
      return () => {
        if (timer) clearTimeout(timer)
      }
    }

    const tiny = document.createElement('canvas')
    tiny.width = resolution
    tiny.height = resolution
    const tctx = tiny.getContext('2d')
    if (!tctx) return
    tctx.imageSmoothingEnabled = true

    const img = new Image()
    img.src = src
    img.onload = () => {
      // cover-crop source into the tiny square
      const sAspect = img.width / img.height
      let sw = img.width
      let sh = img.height
      let sx = 0
      let sy = 0
      if (sAspect > 1) {
        sw = img.height
        sx = (img.width - sw) / 2
      } else {
        sh = img.width
        sy = (img.height - sh) / 2
      }
      tctx.clearRect(0, 0, tiny.width, tiny.height)
      tctx.drawImage(img, sx, sy, sw, sh, 0, 0, tiny.width, tiny.height)
      ctx.imageSmoothingEnabled = false
      ctx.clearRect(0, 0, W, H)
      ctx.drawImage(tiny, 0, 0, W, H)
    }
    img.onerror = onError
    return () => {
      if (timer) clearTimeout(timer)
    }
  }, [srcs, skip, startAt, resolution, seed, retryTick])

  return (
    <canvas
      ref={ref}
      width={W}
      height={H}
      style={{ width: '100%', borderRadius: 12, imageRendering: resolution === 0 ? 'auto' : 'pixelated' }}
    />
  )
}
