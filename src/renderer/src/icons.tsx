import type { JSX } from 'react'

function Stroke({ children }: { children: JSX.Element | JSX.Element[] }): JSX.Element {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  )
}

export function GhostMark(): JSX.Element {
  return (
    <svg data-testid="ghost-mark" width="36" height="36" viewBox="0 0 64 64" aria-hidden="true">
      <path
        d="M32 6c-12.5 0-21 10.2-21 24.5V62l7.2-6.2L25 62l7-6.2L39 62l6.8-6.2L53 62V30.5C53 16.2 44.5 6 32 6z"
        fill="#f4efe6"
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
  )
}

export function IconDice(): JSX.Element {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <rect x="1" y="1" width="16" height="16" rx="3.2" fill="currentColor" />
      <circle cx="5.2" cy="5.2" r="1.45" fill="#141210" />
      <circle cx="12.8" cy="5.2" r="1.45" fill="#141210" />
      <circle cx="9" cy="9" r="1.45" fill="#141210" />
      <circle cx="5.2" cy="12.8" r="1.45" fill="#141210" />
      <circle cx="12.8" cy="12.8" r="1.45" fill="#141210" />
    </svg>
  )
}

export function IconFullScreen(): JSX.Element {
  return (
    <Stroke>
      <path d="M3 6.5V3h3.5M9.5 3H13v3.5M13 9.5V13H9.5M6.5 13H3V9.5" />
    </Stroke>
  )
}

export function IconDrag(): JSX.Element {
  return (
    <Stroke>
      <rect x="2.5" y="3.5" width="8" height="8" rx="1" />
      <path d="M10.5 10.5 L13.5 13.5M11.5 13.5h2v-2" />
    </Stroke>
  )
}

export function IconWindow(): JSX.Element {
  return (
    <Stroke>
      <rect x="2" y="2.5" width="12" height="11" rx="1.2" />
      <path d="M6 5.7 l0 5.2 1.6-1.5 1.1 2 1-.5-1.1-2 2.2 0z" fill="currentColor" stroke="none" />
    </Stroke>
  )
}

export function IconBug(): JSX.Element {
  return (
    <svg data-testid="ladybug" width="22" height="22" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M6.3 5.2 4.7 2.7M9.7 5.2 11.3 2.7"
        fill="none"
        stroke="#d4cfc4"
        strokeWidth="1.15"
        strokeLinecap="round"
      />
      <circle cx="4.45" cy="2.45" r="0.85" fill="#e8e3d8" />
      <circle cx="11.55" cy="2.45" r="0.85" fill="#e8e3d8" />
      <circle cx="8" cy="9.4" r="5.15" fill="#e8e3d8" stroke="#d4cfc4" strokeWidth="0.7" />
      <path d="M3.5 8.2a4.6 4.4 0 0 1 9 0Z" fill="#5c574e" />
      <path d="M8 5.6v7.6" stroke="#5c574e" strokeWidth="1" />
      <circle cx="5.7" cy="10.3" r="1.45" fill="#5c574e" />
      <circle cx="10.3" cy="10.3" r="1.45" fill="#5c574e" />
    </svg>
  )
}

export function IconSun(): JSX.Element {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 14 14"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
    >
      <circle cx="7" cy="7" r="2.1" fill="currentColor" stroke="none" />
      <path d="M7 1.4v1.6M7 11v1.6M1.4 7h1.6M11 7h1.6M2.9 2.9l1.1 1.1M10 10l1.1 1.1M11.1 2.9L10 4M4 10l-1.1 1.1" />
    </svg>
  )
}
