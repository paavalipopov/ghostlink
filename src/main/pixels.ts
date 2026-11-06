import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { screen } from 'electron'
import type { Bounds, Point } from '../shared/coords'

let cursorAlreadyPhysical = process.platform === 'win32'

const CURSOR_SCRIPT = `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class GhostlinkCursor {
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("shcore.dll")] public static extern int SetProcessDpiAwareness(int awareness);
  public static string Now() {
    try {
      if (SetProcessDpiAwareness(2) != 0) SetProcessDPIAware();
    } catch {
      try { SetProcessDPIAware(); } catch { }
    }
    POINT p;
    if (!GetCursorPos(out p)) return "";
    return p.X + " " + p.Y;
  }
}
'@
[GhostlinkCursor]::Now()
`

function readWin32Cursor(): Point | null {
  if (process.platform !== 'win32') return null
  const dir = mkdtempSync(join(tmpdir(), 'ghostlink-cursor-'))
  const file = join(dir, 'cursor.ps1')
  try {
    writeFileSync(file, CURSOR_SCRIPT, 'utf8')
    const stdout = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-File', file],
      { encoding: 'utf8', timeout: 8000, windowsHide: true }
    )
    const match = /(\d+)\s+(\d+)/.exec(stdout)
    if (!match) return null
    return { x: Number(match[1]), y: Number(match[2]) }
  } catch {
    return null
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

export function calibratePointer(): void {
  const reported = screen.getCursorScreenPoint()
  const native = readWin32Cursor()
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
