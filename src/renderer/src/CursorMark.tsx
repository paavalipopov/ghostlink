import type { JSX } from 'react'

export function CursorMark({ name, color }: { name: string; color: string }): JSX.Element {
  return (
    <div style={{ pointerEvents: 'none' }}>
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
    </div>
  )
}
