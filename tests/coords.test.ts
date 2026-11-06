import { describe, expect, it } from 'vitest'
import {
  applyCorner,
  isInside,
  normalize,
  project,
  quantize,
  rectBetween
} from '../src/shared/coords'
import { parseWindowRow } from '../src/shared/parse-windows'
import { explainLinkError, roomIdFromCode } from '../src/shared/protocol'

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

describe('window parsers', () => {
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
  it('derives the same room id on both computers', async () => {
    const first = await roomIdFromCode('amber harbor')
    const second = await roomIdFromCode('  amber harbor  ')
    const other = await roomIdFromCode('amber-harbor')
    expect(first).toBe(second)
    expect(first).not.toBe(other)
    expect(first).toMatch(/^[0-9a-f]{64}$/)
  })

  it('explains a blocked direct path', () => {
    expect(explainLinkError('ICE connection failed')).toMatch(/direct path/)
    expect(explainLinkError('bad password')).toMatch(/shared code/)
  })
})
