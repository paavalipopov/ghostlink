import { describe, expect, it, vi } from 'vitest'
import {
  applyCorner,
  isInside,
  normalize,
  project,
  quantize,
  rectBetween
} from '../src/shared/coords'
import { parseCursorRow, parseWindowRow } from '../src/shared/parse-windows'
import {
  codeIsStrong,
  explainLinkError,
  makeCode,
  roomIdFromCode,
  unitPoint
} from '../src/shared/protocol'

describe('Electron reference: native helper cursor parser', () => {
  it('preserves negative coordinates on displays left of or above the primary display', () => {
    expect(parseCursorRow('-1920 300')).toEqual({ x: -1920, y: 300 })
    expect(parseCursorRow('200 -1200')).toEqual({ x: 200, y: -1200 })
    expect(parseCursorRow(' -1 -2\r\n')).toEqual({ x: -1, y: -2 })
    expect(parseCursorRow('0 0')).toEqual({ x: 0, y: 0 })
  })

  it('rejects incomplete or malformed helper replies', () => {
    expect(parseCursorRow('')).toBeNull()
    expect(parseCursorRow('cursor 1 2')).toBeNull()
    expect(parseCursorRow('1 -')).toBeNull()
    expect(parseCursorRow('1.5 2')).toBeNull()
    expect(parseCursorRow('9007199254740992 0')).toBeNull()
  })
})

describe('play area coordinates', () => {
  const area = { x: 100, y: 50, width: 200, height: 100 }

  it('normalizes a point inside the game picture', () => {
    expect(normalize({ x: 150, y: 75 }, area)).toEqual({ x: 0.25, y: 0.25 })
    expect(isInside(normalize({ x: 150, y: 75 }, area))).toBe(true)
  })

  it('keeps points outside the picture outside', () => {
    const point = normalize({ x: 10, y: 75 }, area)
    expect(point.x).toBeLessThan(0)
    expect(isInside(point)).toBe(false)
  })

  it('projects a normalized point back onto the picture', () => {
    expect(project({ x: 0.5, y: 1 }, area)).toEqual({ x: 200, y: 150 })
  })

  it('quantizes to thousandths so tiny mouse jitter is not sent', () => {
    expect(quantize(0.1234)).toBe(0.123)
    expect(quantize(0.1235)).toBe(0.124)
  })

  it('uses the rectangle between two drag points', () => {
    expect(rectBetween({ x: 900, y: 200 }, { x: 400, y: 700 })).toEqual({
      x: 400,
      y: 200,
      width: 500,
      height: 500
    })
  })

  it('moves one corner without collapsing the rectangle', () => {
    expect(applyCorner(area, 'top-left', { x: 120, y: 60 })).toEqual({
      x: 120,
      y: 60,
      width: 180,
      height: 90
    })
    expect(applyCorner(area, 'bottom-right', { x: 140, y: 80 })).toEqual({
      x: 100,
      y: 50,
      width: 40,
      height: 40
    })
  })
})

describe('Electron reference: window helper parser', () => {
  it('reads a Win32 window row', () => {
    expect(parseWindowRow('99\t10\t30\t640\t480\tThimbleweed Park')).toEqual({
      id: '99',
      title: 'Thimbleweed Park',
      x: 10,
      y: 30,
      width: 640,
      height: 480
    })
  })

  it('rejects a tab-separated row for this app', () => {
    expect(parseWindowRow('12\t0\t0\t800\t600\tGhostlink')).toBeNull()
  })
})

describe('shared code', () => {
  it('preserves the room-id digest and whitespace rules used by released clients', async () => {
    const first = await roomIdFromCode('amber harbor')
    const second = await roomIdFromCode('  amber harbor  ')
    const other = await roomIdFromCode('amber-harbor')
    expect(first).toBe('74824d10ab0987d4458b1ae15d38e4cd64e3c6a15190f5a5febafab59fef1db6')
    expect(second).toBe(first)
    expect(other).toBe('9b6e70b8d14a5c2d518a1f8827d4145fc6bca3f988b6d5b9935b813991ff210f')
  })

  it('uses Web Crypto bytes when generating a code, including the first and last alphabet values', () => {
    for (const [byte, expected] of [
      [0, '0000-0000-0000-0000-0000'],
      [255, 'zzzz-zzzz-zzzz-zzzz-zzzz']
    ] as const) {
      const random = vi.fn((bytes: Uint8Array) => {
        bytes.fill(byte)
        return bytes
      })
      vi.stubGlobal('crypto', { getRandomValues: random })
      try {
        expect(makeCode()).toBe(expected)
        expect(random).toHaveBeenCalledOnce()
      } finally {
        vi.unstubAllGlobals()
      }
    }
  })

  it('makes a code long enough to paste, and rejects a short one', () => {
    const code = makeCode()
    expect(code).toMatch(/^[0-9abcdefghjkmnpqrstvwxyz]{4}(?:-[0-9abcdefghjkmnpqrstvwxyz]{4}){4}$/)
    expect(code.replace(/-/g, '')).toHaveLength(20)
    expect(codeIsStrong(code)).toBe(true)
    expect(codeIsStrong('amber-harbor-42')).toBe(true)
    expect(codeIsStrong('short')).toBe(false)
  })

  it('accepts six secret characters, ignoring spaces and hyphens in the count', () => {
    expect(codeIsStrong('abc123')).toBe(true)
    expect(codeIsStrong('  abc-123  ')).toBe(true)
    expect(codeIsStrong('abc12')).toBe(false)
    expect(codeIsStrong('  ab-c 12  ')).toBe(false)
    expect(codeIsStrong('------')).toBe(false)
  })

  it('ignores a point that is not inside the frame', () => {
    expect(unitPoint(0.2, 0.4)).toEqual({ x: 0.2, y: 0.4 })
    expect(unitPoint(1.2, 0.4)).toBeNull()
    expect(unitPoint(Number.NaN, 0)).toBeNull()
    expect(unitPoint(Number.POSITIVE_INFINITY, 0.2)).toBeNull()
    expect(unitPoint(null, null)).toBeNull()
  })

  it('explains a blocked direct path', () => {
    expect(explainLinkError('ICE connection failed')).toMatch(/direct path/)
    expect(explainLinkError('bad password')).toMatch(/shared code/)
  })
})
