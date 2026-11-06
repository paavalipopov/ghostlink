import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SCRIPT = String.raw`
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class GhostlinkWin {
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr hwnd, uint gaFlags);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr hWnd, uint uCmd);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("shcore.dll")] public static extern int SetProcessDpiAwareness(int awareness);
  public static void EnableDpi() {
    try {
      if (SetProcessDpiAwareness(2) != 0) SetProcessDPIAware();
    } catch {
      try { SetProcessDPIAware(); } catch { }
    }
  }
  public static string Now() {
    EnableDpi();
    POINT p;
    if (!GetCursorPos(out p)) return "";
    return p.X + " " + p.Y;
  }
  static string TitleOf(IntPtr h) {
    int len = GetWindowTextLength(h);
    var sb = new StringBuilder(Math.Max(len, 0) + 1);
    if (len > 0) GetWindowText(h, sb, sb.Capacity);
    return sb.ToString().Replace("\t", " ").Replace("\r", " ").Replace("\n", " ").Trim();
  }
  static bool Ours(string title) {
    if (title.Length == 0) return false;
    return title.StartsWith("Ghostlink", StringComparison.OrdinalIgnoreCase)
      && (title.Length == 9 || !char.IsLetterOrDigit(title[9]));
  }
  static string Row(IntPtr h) {
    RECT r;
    if (!GetWindowRect(h, out r)) return "";
    string title = TitleOf(h);
    return h.ToInt64() + "\t" + r.Left + "\t" + r.Top + "\t" + (r.Right - r.Left) + "\t" + (r.Bottom - r.Top) + "\t" + title;
  }
  public static string At(int x, int y) {
    EnableDpi();
    POINT p = new POINT { X = x, Y = y };
    IntPtr h = WindowFromPoint(p);
    if (h == IntPtr.Zero) return "";
    for (int i = 0; i < 24 && h != IntPtr.Zero; i++) {
      IntPtr root = GetAncestor(h, 2);
      if (root != IntPtr.Zero) h = root;
      if (IsWindowVisible(h)) {
        RECT r;
        if (GetWindowRect(h, out r) && p.X >= r.Left && p.X < r.Right && p.Y >= r.Top && p.Y < r.Bottom) {
          string title = TitleOf(h);
          if (title.Length > 0 && !Ours(title)) return Row(h);
        }
      }
      h = GetWindow(h, 2);
    }
    return "";
  }
}
'@
[Console]::Out.WriteLine('ready')
[Console]::Out.Flush()
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line -or $line -eq 'quit') { break }
  $answer = ''
  if ($line -eq 'cursor') { $answer = [GhostlinkWin]::Now() }
  elseif ($line.StartsWith('at ')) {
    $bits = $line.Split(' ')
    $answer = [GhostlinkWin]::At([int]$bits[1], [int]$bits[2])
  }
  [Console]::Out.WriteLine($answer)
  [Console]::Out.Flush()
}
`

let child: ChildProcessWithoutNullStreams | null = null
let dir: string | null = null
let started: Promise<void> | null = null
let buffer = ''
let waiter: ((line: string) => void) | null = null
let chain: Promise<void> = Promise.resolve()

function takeLine(): void {
  if (!waiter) return
  const nl = buffer.indexOf('\n')
  if (nl < 0) return
  const line = buffer.slice(0, nl).replace(/\r$/, '')
  buffer = buffer.slice(nl + 1)
  const done = waiter
  waiter = null
  done(line)
}

function onOut(chunk: Buffer): void {
  buffer += chunk.toString('utf8')
  takeLine()
}

export function ensureWin32(): Promise<void> {
  if (process.platform !== 'win32') return Promise.resolve()
  if (child && !child.killed && started) return started
  buffer = ''
  waiter = null
  dir = mkdtempSync(join(tmpdir(), 'ghostlink-win32-'))
  const file = join(dir, 'win32.ps1')
  writeFileSync(file, SCRIPT, 'utf8')
  const proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', file], {
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe']
  })
  child = proc
  started = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Win32 helper did not start')), 8000)
    const onReady = (chunk: Buffer): void => {
      buffer += chunk.toString('utf8')
      const at = buffer.indexOf('ready')
      if (at < 0) return
      clearTimeout(timer)
      buffer = buffer.slice(at + 'ready'.length).replace(/^\r?\n/, '')
      proc.stdout.off('data', onReady)
      proc.stdout.on('data', onOut)
      resolve()
    }
    proc.stdout.on('data', onReady)
    proc.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    proc.once('exit', () => {
      child = null
      started = null
    })
  })
  return started
}

export function askWin32(command: string): Promise<string> {
  const run = chain.then(async () => {
    await ensureWin32()
    if (!child) throw new Error('Win32 helper is not running')
    return await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        waiter = null
        reject(new Error('Win32 helper timed out'))
      }, 8000)
      waiter = (line) => {
        clearTimeout(timer)
        resolve(line)
      }
      child?.stdin.write(`${command}\n`)
      takeLine()
    })
  })
  chain = run.then(
    () => undefined,
    () => undefined
  )
  return run
}

export function stopWin32(): void {
  const proc = child
  child = null
  started = null
  try {
    proc?.stdin.write('quit\n')
    proc?.kill()
  } catch {
    // The helper is already gone.
  }
  if (dir) rmSync(dir, { recursive: true, force: true })
  dir = null
}
