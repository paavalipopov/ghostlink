export type RawWindow = {
  id: string
  title: string
  x: number
  y: number
  width: number
  height: number
}

function keep(window: RawWindow): boolean {
  if (!window.title || /^ghostlink\b/i.test(window.title)) return false
  if (window.width < 80 || window.height < 80) return false
  return [window.x, window.y, window.width, window.height].every(Number.isFinite)
}

export function parseWindowRow(line: string): RawWindow | null {
  const parts = line.replace(/\r$/, '').split('\t')
  if (parts.length < 6) return null
  const [id, xs, ys, ws, hs, ...titleParts] = parts
  const window = {
    id,
    x: Number(xs),
    y: Number(ys),
    width: Number(ws),
    height: Number(hs),
    title: titleParts.join('\t').trim()
  }
  return keep(window) ? window : null
}
