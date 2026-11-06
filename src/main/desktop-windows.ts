import { parseWindowRow, type RawWindow } from '../shared/parse-windows'
import { askWin32 } from './win32'

export type WindowHit = {
  window: RawWindow | null
  note: string | null
}

function hitFromRow(line: string, emptyNote: string): WindowHit {
  const window = parseWindowRow(line)
  if (!window) {
    return {
      window: null,
      note: 'The pointer is over Ghostlink, or over a window that is too small. Move it onto the game and try again.'
    }
  }
  if (!window.title) return { window: null, note: emptyNote }
  return { window, note: null }
}

export async function windowAtPoint(x: number, y: number): Promise<WindowHit> {
  try {
    const line = await askWin32(`at ${Math.round(x)} ${Math.round(y)}`)
    if (!line.includes('\t')) return { window: null, note: 'No window under the pointer.' }
    return hitFromRow(line, 'No window under the pointer.')
  } catch (error) {
    return {
      window: null,
      note: error instanceof Error ? error.message : 'Could not read the window under the pointer.'
    }
  }
}
