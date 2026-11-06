import { useEffect, useRef, useState, type JSX, type PointerEvent } from 'react'

type Shot = { displayId: number; image: string }
type Box = { x: number; y: number; width: number; height: number }

function boxBetween(a: { x: number; y: number }, b: { x: number; y: number }): Box {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y)
  }
}

export function SelectFrame(): JSX.Element {
  const [shot, setShot] = useState<Shot | null>(null)
  const [box, setBox] = useState<Box | null>(null)
  const origin = useRef<{ x: number; y: number } | null>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const sent = useRef(false)

  useEffect(() => {
    void window.api.pickShot().then(setShot)
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || sent.current) return
      sent.current = true
      void window.api.finishPick(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const point = (event: PointerEvent<HTMLDivElement>): { x: number; y: number } | null => {
    const image = imageRef.current
    if (!image) return null
    const rect = image.getBoundingClientRect()
    if (rect.width < 1 || rect.height < 1) return null
    return {
      x: (event.clientX - rect.left) / rect.width,
      y: (event.clientY - rect.top) / rect.height
    }
  }

  const finish = (next: Box | null): void => {
    if (sent.current) return
    sent.current = true
    if (!shot || !next || next.width < 0.01 || next.height < 0.01) {
      void window.api.finishPick(null)
      return
    }
    void window.api.finishPick({ displayId: shot.displayId, space: 'display', ...next })
  }

  return (
    <div
      data-testid="frame-shot"
      style={{
        position: 'fixed',
        inset: 0,
        cursor: 'crosshair',
        background: '#000',
        userSelect: 'none'
      }}
      onPointerDown={(event) => {
        if (event.button !== 0 || !shot) return
        const start = point(event)
        if (!start) return
        origin.current = start
        event.currentTarget.setPointerCapture(event.pointerId)
        setBox(boxBetween(start, start))
      }}
      onPointerMove={(event) => {
        if (!origin.current) return
        const next = point(event)
        if (!next) return
        setBox(boxBetween(origin.current, next))
      }}
      onPointerUp={(event) => {
        const start = origin.current
        origin.current = null
        const end = start ? point(event) : null
        const next = start && end ? boxBetween(start, end) : null
        setBox(next)
        finish(next)
      }}
    >
      {shot && (
        <img
          ref={imageRef}
          src={shot.image}
          alt=""
          draggable={false}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'fill',
            pointerEvents: 'none'
          }}
        />
      )}
      {box && box.width > 0 && box.height > 0 && (
        <div
          data-testid="shot-rect"
          style={{
            position: 'absolute',
            left: `${box.x * 100}%`,
            top: `${box.y * 100}%`,
            width: `${box.width * 100}%`,
            height: `${box.height * 100}%`,
            border: '2px solid #e2a14a',
            boxShadow: 'inset 0 0 0 1px rgba(0, 0, 0, 0.45)',
            pointerEvents: 'none'
          }}
        />
      )}
      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: 24,
          transform: 'translateX(-50%)',
          background: 'rgba(20, 18, 16, 0.9)',
          color: '#f4efe6',
          padding: '10px 16px',
          borderRadius: 12,
          font: '600 14px Segoe UI, sans-serif',
          pointerEvents: 'none'
        }}
      >
        Drag across the game picture
      </div>
    </div>
  )
}
