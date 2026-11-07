import type { JSX } from 'react'
import { CLICK_COLOR, CLICK_MS } from '../../shared/protocol'
import './assets/marks.css'

function MarkFace({ name, color }: { name: string; color: string }): JSX.Element {
  return (
    <>
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        aria-hidden="true"
        style={{ display: 'block', filter: 'drop-shadow(0 1px 1px rgba(0,0,0,.65))' }}
      >
        <path
          d="M5 2.5 L5 19.2 L9.6 14.6 L13.2 21.2 L16.1 19.8 L12.4 13.2 L19 13.2 Z"
          fill={color}
          stroke="#1a140c"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
      </svg>
      <div
        style={{
          marginTop: -4,
          marginLeft: 16,
          display: 'inline-block',
          background: color,
          color: '#1a140c',
          font: '600 12px/1.2 Segoe UI, sans-serif',
          padding: '2px 6px',
          borderRadius: 4,
          whiteSpace: 'nowrap'
        }}
      >
        {name}
      </div>
    </>
  )
}

function GhostFace({ name, color }: { name: string; color: string }): JSX.Element {
  return (
    <>
      <svg
        data-testid="peer-ghost"
        width="36"
        height="36"
        viewBox="0 0 64 64"
        aria-hidden="true"
        style={{ display: 'block', filter: 'drop-shadow(0 1px 1px rgba(0,0,0,.65))' }}
      >
        <path
          d="M32 6c-12.5 0-21 10.2-21 24.5V62l7.2-6.2L25 62l7-6.2L39 62l6.8-6.2L53 62V30.5C53 16.2 44.5 6 32 6z"
          fill={color}
          stroke="#1a140c"
          strokeWidth="2.4"
          strokeLinejoin="round"
        />
        <circle cx="24" cy="28" r="4.48" fill="#1a140c" />
        <circle cx="40" cy="28" r="4.48" fill="#1a140c" />
        <path
          d="M27.9 35.9 27.9 52.1 32.7 47.4 36.3 53.9 39.3 52.4 35.7 45.9 42.4 45.9Z"
          fill="#1a140c"
          stroke="#f4efe6"
          strokeWidth="3.4"
          strokeLinejoin="round"
          paintOrder="stroke fill"
        />
      </svg>
      <div
        style={{
          marginTop: -4,
          marginLeft: 28,
          display: 'inline-block',
          background: color,
          color: '#1a140c',
          font: '600 12px/1.2 Segoe UI, sans-serif',
          padding: '2px 6px',
          borderRadius: 4,
          whiteSpace: 'nowrap'
        }}
      >
        {name}
      </div>
    </>
  )
}

export function CursorMark({
  name,
  color,
  clickKey,
  shape = 'arrow'
}: {
  name: string
  color: string
  clickKey?: string | null
  shape?: 'arrow' | 'ghost'
}): JSX.Element {
  const face = (paint: string): JSX.Element =>
    shape === 'ghost' ? <GhostFace name={name} color={paint} /> : <MarkFace name={name} color={paint} />
  return (
    <div data-mark={shape} style={{ position: 'relative', pointerEvents: 'none' }}>
      {face(color)}
      {clickKey ? (
        <div
          key={clickKey}
          className="click-blink"
          data-testid="click-blink"
          style={{ animationDuration: `${CLICK_MS}ms` }}
        >
          {face(CLICK_COLOR)}
        </div>
      ) : null}
    </div>
  )
}
