export type Bounds = {
  x: number
  y: number
  width: number
  height: number
}

export type Point = {
  x: number
  y: number
}

export type Corner = 'top-left' | 'bottom-right'

const MIN_EDGE = 40

export function normalize(point: Point, area: Bounds): Point {
  return {
    x: (point.x - area.x) / area.width,
    y: (point.y - area.y) / area.height
  }
}

export function isInside(point: Point): boolean {
  return point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1
}

export function project(point: Point, area: Bounds): Point {
  return {
    x: area.x + point.x * area.width,
    y: area.y + point.y * area.height
  }
}

export function quantize(value: number, steps = 1000): number {
  return Math.round(value * steps) / steps
}

export function applyCorner(area: Bounds, corner: Corner, point: Point): Bounds {
  if (corner === 'top-left') {
    const right = area.x + area.width
    const bottom = area.y + area.height
    const x = Math.min(point.x, right - MIN_EDGE)
    const y = Math.min(point.y, bottom - MIN_EDGE)
    return { x, y, width: right - x, height: bottom - y }
  }

  return {
    x: area.x,
    y: area.y,
    width: Math.max(MIN_EDGE, point.x - area.x),
    height: Math.max(MIN_EDGE, point.y - area.y)
  }
}
