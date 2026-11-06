import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { parseWindowRow, type RawWindow } from '../shared/parse-windows'

const execFileAsync = promisify(execFile)

export type WindowHit = {
  window: RawWindow | null
  note: string | null
}

const POWERSHELL = String.raw`
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class GhostlinkWin {
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr hwnd, uint gaFlags);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("shcore.dll")] public static extern int SetProcessDpiAwareness(int awareness);
  public static void EnableDpi() {
    try {
      if (SetProcessDpiAwareness(2) != 0) SetProcessDPIAware();
    } catch {
      try { SetProcessDPIAware(); } catch { }
    }
  }
  public static string Line(IntPtr h) {
    if (h == IntPtr.Zero) return "";
    int len = GetWindowTextLength(h);
    var sb = new StringBuilder(Math.Max(len, 0) + 1);
    if (len > 0) GetWindowText(h, sb, sb.Capacity);
    RECT r;
    if (!GetWindowRect(h, out r)) return "";
    int w = r.Right - r.Left;
    int ht = r.Bottom - r.Top;
    string title = sb.ToString().Replace("\t", " ").Replace("\r", " ").Replace("\n", " ");
    return h.ToInt64() + "\t" + r.Left + "\t" + r.Top + "\t" + w + "\t" + ht + "\t" + title;
  }
  public static string At(int x, int y) {
    EnableDpi();
    IntPtr h = WindowFromPoint(new POINT { X = x, Y = y });
    if (h == IntPtr.Zero) return "";
    IntPtr root = GetAncestor(h, 2);
    if (root != IntPtr.Zero) h = root;
    return Line(h);
  }
}
'@
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
`

async function run(command: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(command, args, {
    timeout: 8000,
    windowsHide: true,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024
  })
  return stdout
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

async function runPowerShell(body: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'ghostlink-'))
  const file = join(dir, 'query.ps1')
  await writeFile(file, `${POWERSHELL}\n${body}\n`, 'utf8')
  try {
    return await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', file])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

export async function windowAtPoint(x: number, y: number): Promise<WindowHit> {
  try {
    const stdout = await runPowerShell(`[GhostlinkWin]::At(${Math.round(x)}, ${Math.round(y)})`)
    const line = stdout
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean)
      .at(-1)
    if (!line || !line.includes('\t')) {
      return { window: null, note: 'No window under the pointer.' }
    }
    return hitFromRow(line, 'No window under the pointer.')
  } catch (error) {
    return {
      window: null,
      note: error instanceof Error ? error.message : 'Could not read the window under the pointer.'
    }
  }
}
