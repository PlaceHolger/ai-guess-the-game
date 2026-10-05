import { useEffect, useRef, useState } from 'react'

interface Props {
  /** screenshot candidates in preference order (primary, then review alternates) */
  srcs: string[]
  /** which candidate to try first (persisted rotation: next round => next shot) */
  startAt: number
  /** pixel grid size, 0 = full resolution */
  resolution: number
  seed: string
  /** reports the actually displayed candidate index (follows fallthrough) */
  onShow?: (idx: number) => void
  /** reports the loaded image aspect (width/height) for honest grid labels */
  onAspect?: (aspect: number) => void
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
 *
 * Loading strategy: one shared in-memory image per URL (no re-download
 * across resolutions — always the full variant, since IGDB's smaller
 * sizes are center-cropped and would show different content), and LOADING
 * only paints after 250ms so cached draws never flash. Listeners are added
 * (never assigned) so concurrent runs can't clobber each other, and a
 * cached entry that finished without pixels (a failed load never re-fires
 * events) is swapped for a fresh load instead of hanging on LOADING.
 */
const imgCache = new Map<string, HTMLImageElement>()

function loadableImage(src: string): HTMLImageElement {
  const cached = imgCache.get(src)
  if (cached && !(cached.complete && cached.naturalWidth === 0)) return cached
  // Missing, still loading, decoded — or dead (finished without pixels).
  // A dead entry never re-fires load/error, so waiting on it would hang on
  // LOADING forever: drop it and start a fresh load instead.
  if (cached) imgCache.delete(src)
  const img = new Image()
  img.src = src
  imgCache.set(src, img)
  if (imgCache.size > 12) {
    const oldest = imgCache.keys().next()
    if (!oldest.done && oldest.value !== src) imgCache.delete(oldest.value)
  }
  return img
}
export default function PixelCanvas({ srcs, startAt, resolution, seed, onShow, onAspect }: Props) {
  const ref = useRef<HTMLCanvasElement>(null)
  const [skip, setSkip] = useState(0)
  const [retryTick, setRetryTick] = useState(0)
  const retried = useRef(new Set<number>())
  const srcKey = srcs.join('|')
  // Fallthrough progress (skip/retries) belongs to the screenshot list, not
  // the resolution: switching levels must keep the same candidate instead
  // of restarting on a broken first URL (which hung on LOADING forever).
  const listKey = `${srcKey}@${startAt}`
  useEffect(() => {
    setSkip(0)
    setRetryTick(0)
    retried.current = new Set()
  }, [listKey])

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
    // loadableImage already swaps dead entries for a fresh load; the retry
    // run below just needs a new element, it must not evict healthy decoded
    // images on every later render (that forced a re-download per level).
    const img = loadableImage(src)

    let timer: ReturnType<typeof setTimeout> | undefined
    let settled = false
    const detach = () => {
      img.removeEventListener('load', onLoad)
      img.removeEventListener('error', onError)
    }
    const onError = () => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      detach()
      // Drop the failed element so the retry really hits the network.
      imgCache.delete(src)
      if (!retried.current.has(idx)) {
        retried.current.add(idx)
        timer = setTimeout(() => setRetryTick((t) => t + 1), 1200)
      } else {
        setSkip((s) => s + 1)
      }
    }
    const drawFull = () => {
      // contain (never stretch, never crop): full image, bars if needed
      ctx.imageSmoothingEnabled = true
      const scale = Math.min(W / img.width, H / img.height)
      const dw = img.width * scale
      const dh = img.height * scale
      ctx.fillStyle = '#000'
      ctx.fillRect(0, 0, W, H)
      ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh)
    }
    const drawPixels = () => {
      // grid follows the source aspect (96x54 for 16:9, not 96x96): every
      // pixel of the shot survives, cells stay square, nothing is cropped
      const sAspect = img.width / img.height
      const tw = sAspect >= 1 ? resolution : Math.max(1, Math.round(resolution * sAspect))
      const th = sAspect >= 1 ? Math.max(1, Math.round(resolution / sAspect)) : resolution
      const tiny = document.createElement('canvas')
      tiny.width = tw
      tiny.height = th
      const tctx = tiny.getContext('2d')
      if (!tctx) return
      tctx.imageSmoothingEnabled = true
      tctx.clearRect(0, 0, tw, th)
      tctx.drawImage(img, 0, 0, img.width, img.height, 0, 0, tw, th)
      ctx.imageSmoothingEnabled = false
      ctx.fillStyle = '#000'
      ctx.fillRect(0, 0, W, H)
      // same contain rule as full-res: no stretch, bars if the grid is narrower
      const tAspect = tw / th
      let dw = W
      let dh = H
      if (tAspect > W / H) dh = W / tAspect
      else dw = H * tAspect
      ctx.drawImage(tiny, (W - dw) / 2, (H - dh) / 2, dw, dh)
    }
    const draw = () => (resolution === 0 ? drawFull() : drawPixels())

    // Cached and decoded: paint immediately, no loading flash.
    if (img.complete && img.naturalWidth > 0) {
      if (onAspect) onAspect(img.naturalWidth / img.naturalHeight)
      draw()
      if (onShow) onShow(idx)
      return
    }
    // Otherwise show LOADING only if it actually takes a moment.
    timer = setTimeout(() => {
      if (!settled) drawLoading(ctx)
    }, 250)
    const onLoad = () => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      detach()
      if (onAspect) onAspect(img.naturalWidth / img.naturalHeight)
      draw()
      if (onShow) onShow(idx)
    }
    img.addEventListener('load', onLoad)
    img.addEventListener('error', onError)
    return () => {
      settled = true
      if (timer) clearTimeout(timer)
      detach()
    }
  }, [srcKey, skip, startAt, resolution, seed, retryTick])

  return (
    <canvas
      ref={ref}
      width={W}
      height={H}
      style={{ width: '100%', borderRadius: 12, imageRendering: resolution === 0 ? 'auto' : 'pixelated' }}
    />
  )
}
