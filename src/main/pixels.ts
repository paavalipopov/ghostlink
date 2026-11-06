import { screen } from 'electron'
import type { Bounds, Point } from '../shared/coords'
import { askWin32 } from './win32'

let cursorAlreadyPhysical = process.platform === 'win32'

async function readWin32Cursor(): Promise<Point | null> {
  if (process.platform !== 'win32') return null
  try {
    const line = await askWin32('cursor')
    const match = /(\d+)\s+(\d+)/.exec(line)
    if (!match) return null
    return { x: Number(match[1]), y: Number(match[2]) }
  } catch {
    return null
  }
}

export async function calibratePointer(): Promise<void> {
  const reported = screen.getCursorScreenPoint()
  const native = await readWin32Cursor()
  if (!native) return
  const dip = screen.screenToDipPoint(native)
  const toNative = Math.abs(reported.x - native.x) + Math.abs(reported.y - native.y)
  const toDip = Math.abs(reported.x - dip.x) + Math.abs(reported.y - dip.y)
  cursorAlreadyPhysical = toNative <= toDip
}

export function pointerPhysical(): Point {
  const reported = screen.getCursorScreenPoint()
  return cursorAlreadyPhysical ? reported : screen.dipToScreenPoint(reported)
}

export function physicalBounds(dip: Bounds): Bounds {
  const rect = screen.dipToScreenRect(null, dip)
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
}
