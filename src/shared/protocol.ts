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
  flashId: string
}

export type OverlayModel = {
  showFrame: boolean
  frame: Bounds | null
  mark: MarkState
  picking: boolean
  cursor: Point | null
  ghosts: OverlayGhost[]
}

export type FramePick =
  | {
      space: 'display'
      displayId: number
      x: number
      y: number
      width: number
      height: number
    }
  | {
      space: 'overlay'
      x1: number
      y1: number
      x2: number
      y2: number
    }

export type HookStatus = {
  live: boolean
  detail: string
}

const PALETTE = ['#e2a14a', '#6cb6d9', '#d46a8c', '#8fbf6a', '#c7b4f0']

export const CLICK_COLOR = '#f4efe6'
export const CLICK_MS = 1000
export const LIVE_COLOR = '#3dbe6a'
export const ERROR_COLOR = '#d4654a'
export const WAIT_COLOR = '#e2a14a'
export const IDLE_RING = '#a8a092'
export const MAX_PEERS = 8
export const MAX_PINGS = 4
export const MAX_PING_ID = 64

export function makePingId(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

const CODE_ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz'

export function makeCode(): string {
  const bytes = new Uint8Array(13)
  crypto.getRandomValues(bytes)
  let bits = 0n
  for (const byte of bytes) bits = (bits << 8n) | BigInt(byte)
  let raw = ''
  for (let i = 0; i < 20; i++) {
    const shift = BigInt(99 - i * 5)
    raw += CODE_ALPHABET[Number((bits >> shift) & 31n)]
  }
  return [0, 4, 8, 12, 16].map((start) => raw.slice(start, start + 4)).join('-')
}

export function codeIsStrong(code: string): boolean {
  return code.trim().replace(/[\s-]/g, '').length >= 6
}

export function unitPoint(x: unknown, y: unknown): { x: number; y: number } | null {
  if (typeof x !== 'number' || typeof y !== 'number') return null
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  if (x < 0 || x > 1 || y < 0 || y > 1) return null
  return { x, y }
}

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
