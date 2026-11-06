import type { Bounds, Point } from './coords'

export const APP_ID = 'app.ghostlink.pointer'

export type Sample = {
  x: number
  y: number
  inside: boolean
}

export type DisplayInfo = {
  id: number
  label: string
  primary: boolean
  bounds: Bounds
}

export type MoveMessage = {
  name: string
  x: number | null
  y: number | null
}

export type PingMessage = {
  name: string
  x: number
  y: number
  id: string
}

export type GhostUpdate = {
  id: string
  name: string
  color: string
  x: number | null
  y: number | null
  pings: { id: string; x: number; y: number }[]
}

export type MarkKind = 'top-left' | 'bottom-right' | 'window'

export type MarkState = {
  kind: MarkKind
  count: number
} | null

export type OverlayGhost = {
  id: string
  name: string
  color: string
  x: number
  y: number
  nx: number | null
  ny: number | null
  visible: boolean
  flash: boolean
}

export type OverlayModel = {
  showFrame: boolean
  frame: Bounds | null
  mark: MarkState
  cursor: Point | null
  ghosts: OverlayGhost[]
}

export type HookStatus = {
  live: boolean
  detail: string
}

const PALETTE = ['#e2a14a', '#6cb6d9', '#d46a8c', '#8fbf6a', '#c7b4f0']

export const CLICK_COLOR = '#f4efe6'

export function colorForPeer(id: string): string {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash * 33 + id.charCodeAt(i)) >>> 0
  return PALETTE[hash % PALETTE.length]
}

export async function roomIdFromCode(code: string): Promise<string> {
  const data = new TextEncoder().encode(`ghostlink:${code.trim()}`)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function explainLinkError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error ?? '')
  if (/password|decrypt|cipher/i.test(text)) {
    return 'The shared code does not match on both computers.'
  }
  if (/ice|turn|timed out|failed to connect/i.test(text)) {
    return 'You found each other, but the direct path is blocked.'
  }
  return text || 'The link failed.'
}
