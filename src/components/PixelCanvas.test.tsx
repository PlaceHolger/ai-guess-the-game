// @vitest-environment jsdom
/**
 * Regression tests for the "stuck on LOADING when switching resolution"
 * bug: a dead first candidate (failed CDN file) must fall through to the
 * next screenshot, and switching pixel levels must keep that candidate
 * instead of restarting on the dead URL forever.
 *
 * The browser is faked: MockImage mimics real Image semantics (a failed
 * element is complete with zero pixels and never re-fires events) with
 * test-controlled per-URL behavior, and canvas 2d contexts record calls.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import PixelCanvas from './PixelCanvas'

interface Rec {
  m: string
  args: unknown[]
}

// ---- fake canvas 2d context (records calls per canvas element) ----
function makeCtx(): any {
  const rec: Rec[] = []
  return {
    _rec: rec,
    fillStyle: '',
    font: '',
    imageSmoothingEnabled: true,
    fillRect: (...args: unknown[]) => rec.push({ m: 'fillRect', args }),
    clearRect: (...args: unknown[]) => rec.push({ m: 'clearRect', args }),
    drawImage: (...args: unknown[]) => rec.push({ m: 'drawImage', args }),
    fillText: (...args: unknown[]) => rec.push({ m: 'fillText', args }),
    createLinearGradient: () => ({ addColorStop: () => undefined }),
  }
}

function installCanvasStub() {
  const proto = HTMLCanvasElement.prototype as unknown as { getContext: () => unknown }
  proto.getContext = function (this: unknown) {
    const self = this as { __ctx?: { _rec: Rec[] } }
    if (!self.__ctx) self.__ctx = makeCtx()
    return self.__ctx
  }
}

const recOf = (el: HTMLCanvasElement): Rec[] =>
  (el as unknown as { __ctx: { _rec: Rec[] } }).__ctx._rec
const draws = (rec: Rec[]): number => rec.filter((r) => r.m === 'drawImage').length
const loadings = (rec: Rec[]): number =>
  rec.filter((r) => r.m === 'fillText' && r.args[0] === 'LOADING…').length

// ---- fake Image with test-controlled network ----
type Beh = 'ok' | 'fail'
const behavior = new Map<string, Beh>()
const pendingImgs: MockImage[] = []

class MockImage {
  complete = false
  naturalWidth = 0
  naturalHeight = 0
  width = 0
  height = 0
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  private _u = ''
  private _listeners: Record<string, Array<() => void>> = { load: [], error: [] }
  set src(u: string) {
    this._u = u
    pendingImgs.push(this)
  }
  get src(): string {
    return this._u
  }
  addEventListener(t: string, f: () => void): void {
    this._listeners[t].push(f)
  }
  removeEventListener(t: string, f: () => void): void {
    this._listeners[t] = this._listeners[t].filter((x) => x !== f)
  }
  /** Fire both the on* property and all listeners, like the browser does. */
  emit(t: 'load' | 'error'): void {
    if (t === 'load' && this.onload) this.onload()
    if (t === 'error' && this.onerror) this.onerror()
    this._listeners[t].forEach((f) => f())
  }
}

/** Deliver queued network results synchronously (unset URLs stay in flight). */
function flushNet(): void {
  for (const img of pendingImgs.splice(0)) {
    const b = behavior.get(img.src)
    if (b === 'ok') {
      img.complete = true
      img.naturalWidth = 800
      img.naturalHeight = 450
      img.width = 800
      img.height = 450
      img.emit('load')
    } else if (b === 'fail') {
      img.complete = true // dead: finished, zero pixels, error fires once
      img.naturalWidth = 0
      img.emit('error')
    } else {
      pendingImgs.push(img) // still loading
    }
  }
}

const flush = (): void => {
  act(() => {
    flushNet()
  })
}
const advance = (ms: number): void => {
  act(() => {
    vi.advanceTimersByTime(ms)
  })
}

let n = 0
const url = (name: string): string => `https://shots.test/${name}-${n++}.jpg`

beforeEach(() => {
  vi.useFakeTimers()
  installCanvasStub()
  ;(globalThis as unknown as { Image: unknown }).Image = MockImage
  behavior.clear()
  pendingImgs.length = 0
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('PixelCanvas', () => {
  it('draws a loaded screenshot without a loading flash', () => {
    const good = url('good')
    behavior.set(good, 'ok')
    const onShow = vi.fn()
    const onAspect = vi.fn()
    const r = render(
      <PixelCanvas srcs={[good]} startAt={0} resolution={16} seed="g" onShow={onShow} onAspect={onAspect} />,
    )
    flush()
    advance(1000)
    const rec = recOf(r.container.querySelector('canvas')!)
    expect(draws(rec)).toBeGreaterThan(0)
    expect(loadings(rec)).toBe(0)
    expect(onShow).toHaveBeenCalledWith(0)
    expect(onAspect).toHaveBeenCalledWith(800 / 450)
  })

  it('shows LOADING only while a slow load is in flight, then draws', () => {
    const slow = url('slow')
    const r = render(<PixelCanvas srcs={[slow]} startAt={0} resolution={16} seed="g" />)
    advance(300)
    const rec = recOf(r.container.querySelector('canvas')!)
    expect(loadings(rec)).toBeGreaterThan(0)
    behavior.set(slow, 'ok')
    flush()
    expect(draws(rec)).toBeGreaterThan(0)
  })

  it('falls through a dead candidate to the next screenshot', () => {
    const bad = url('bad')
    const good = url('good')
    behavior.set(bad, 'fail')
    behavior.set(good, 'ok')
    const onShow = vi.fn()
    const r = render(
      <PixelCanvas srcs={[bad, good]} startAt={0} resolution={16} seed="g" onShow={onShow} />,
    )
    flush() // bad fails -> one retry scheduled
    advance(1300) // retry fires -> bad fails again -> skip to good
    flush() // retry attempt fails, fallthrough advances
    flush() // good loads
    advance(1000)
    const rec = recOf(r.container.querySelector('canvas')!)
    expect(draws(rec)).toBeGreaterThan(0)
    expect(loadings(rec)).toBe(0)
    expect(onShow).toHaveBeenLastCalledWith(1)
  })

  it('keeps the working candidate when switching resolution (no loading hang)', () => {
    const bad = url('bad')
    const good = url('good')
    behavior.set(bad, 'fail')
    behavior.set(good, 'ok')
    const onShow = vi.fn()
    const props = { srcs: [bad, good], startAt: 0, seed: 'g', onShow }
    const r = render(<PixelCanvas {...props} resolution={16} />)
    flush()
    advance(1300)
    flush()
    flush()
    const canvas = r.container.querySelector('canvas')!
    expect(draws(recOf(canvas))).toBeGreaterThan(0)

    // reveal more: same game, new resolution — must redraw the GOOD shot
    // from cache immediately, never park on LOADING
    r.rerender(<PixelCanvas {...props} resolution={32} />)
    expect(draws(recOf(canvas))).toBeGreaterThan(0)
    advance(5000)
    flush()
    const rec = recOf(canvas)
    expect(loadings(rec)).toBe(0)
    expect(onShow).toHaveBeenLastCalledWith(1)
  })
})
