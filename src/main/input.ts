import { createRequire } from 'node:module'
import { isInside, normalize, quantize, type Bounds } from '../shared/coords'
import type { HookStatus, Sample } from '../shared/protocol'
import { pointerPhysical } from './pixels'

const require = createRequire(import.meta.url)

type MouseHook = {
  on: (event: 'mousedown', listener: (event: { button?: unknown }) => void) => void
  start: () => void
  stop: () => void
}

function attachHook(onClick: () => void): { hook: MouseHook | null; status: HookStatus } {
  try {
    const loaded = require('uiohook-napi') as { uIOhook: MouseHook }
    const hook = loaded.uIOhook
    hook.on('mousedown', (event) => {
      if (event.button !== 1) return
      onClick()
    })
    hook.start()
    return {
      hook,
      status: {
        live: true,
        detail:
          'A click inside the play area blinks their pointer. The click still belongs to your game.'
      }
    }
  } catch (error) {
    return {
      hook: null,
      status: {
        live: false,
        detail: `Click color uses Ctrl+Alt+P. ${error instanceof Error ? error.message : 'Mouse hook unavailable.'}`
      }
    }
  }
}

export function startPointerWatch(opts: {
  getArea: () => Bounds | null
  isMarking: () => boolean
  onSample: (sample: Sample) => void
  onClick: (sample: Sample) => void
  onCursor: () => void
}): {
  stop: () => void
  resync: () => void
  status: HookStatus
} {
  let lastKey = ''
  const timer = setInterval(() => {
    const area = opts.getArea()
    const point = pointerPhysical()
    let sample: Sample
    if (!area || area.width < 2 || area.height < 2) {
      sample = { x: 0, y: 0, inside: false }
    } else {
      const normalized = normalize(point, area)
      sample = {
        x: quantize(normalized.x),
        y: quantize(normalized.y),
        inside: isInside(normalized)
      }
    }
    const key = sample.inside ? `${sample.x},${sample.y}` : 'out'
    if (key !== lastKey) {
      lastKey = key
      opts.onSample(sample)
    }
    if (opts.isMarking()) opts.onCursor()
  }, 33)

  const attached = attachHook(() => {
    const area = opts.getArea()
    if (!area) return
    const normalized = normalize(pointerPhysical(), area)
    if (!isInside(normalized)) return
    opts.onClick({
      x: quantize(normalized.x),
      y: quantize(normalized.y),
      inside: true
    })
  })

  return {
    status: attached.status,
    resync() {
      lastKey = ''
    },
    stop() {
      clearInterval(timer)
      try {
        attached.hook?.stop()
      } catch {
        // The hook may already be stopped during shutdown.
      }
    }
  }
}
