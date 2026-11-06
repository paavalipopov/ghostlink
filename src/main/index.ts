import { app, BrowserWindow, globalShortcut, ipcMain, screen, shell } from 'electron'
import { join } from 'path'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { CH, type PadLaunch } from '../shared/bridge'
import { applyCorner, isInside, normalize, project, quantize, type Bounds } from '../shared/coords'
import type {
  DisplayInfo,
  GhostUpdate,
  MarkKind,
  MarkState,
  OverlayModel
} from '../shared/protocol'
import { windowAtPoint } from './desktop-windows'
import { startPointerWatch } from './input'
import { calibratePointer, physicalBounds, pointerPhysical } from './pixels'

if (process.env.GHOSTLINK_DEBUG === '1') {
  app.commandLine.appendSwitch('remote-debugging-port', '9333')
  app.commandLine.appendSwitch('remote-debugging-address', '127.0.0.1')
}

let control: BrowserWindow | null = null
let overlay: BrowserWindow | null = null
let pad: BrowserWindow | null = null
let playArea: Bounds = { x: 0, y: 0, width: 800, height: 600 }
let showFrame = true
let ghosts: GhostUpdate[] = []
let mark: MarkState = null
let markToken = 0
let overlayDip = { x: 0, y: 0, width: 800, height: 600 }
// Play-area numbers are Windows physical pixels. Electron's own window bounds are DIP.
// The transparent overlay's CSS pixel is whichever of those two spaces it actually renders.
let overlayCssIsPhysical = process.platform === 'win32'

const watch = {
  current: null as ReturnType<typeof startPointerWatch> | null
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function unionBounds(rects: Bounds[]): Bounds {
  if (rects.length === 0) return { x: 0, y: 0, width: 800, height: 600 }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const rect of rects) {
    minX = Math.min(minX, rect.x)
    minY = Math.min(minY, rect.y)
    maxX = Math.max(maxX, rect.x + rect.width)
    maxY = Math.max(maxY, rect.y + rect.height)
  }
  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY)
  }
}

function dipVirtualBounds(): Bounds {
  return unionBounds(screen.getAllDisplays().map((display) => display.bounds))
}

function physicalScreen(): Bounds {
  return unionBounds(screen.getAllDisplays().map((display) => physicalBounds(display.bounds)))
}

function toOverlayPoint(point: { x: number; y: number }): { x: number; y: number } {
  if (overlayCssIsPhysical) {
    const origin = physicalScreen()
    return { x: point.x - origin.x, y: point.y - origin.y }
  }
  const dip = screen.screenToDipPoint(point)
  return { x: dip.x - overlayDip.x, y: dip.y - overlayDip.y }
}

function toOverlayRect(area: Bounds): Bounds {
  if (overlayCssIsPhysical) {
    const origin = physicalScreen()
    return {
      x: area.x - origin.x,
      y: area.y - origin.y,
      width: area.width,
      height: area.height
    }
  }
  const dip = screen.screenToDipRect(null, area)
  return {
    x: dip.x - overlayDip.x,
    y: dip.y - overlayDip.y,
    width: dip.width,
    height: dip.height
  }
}

async function syncOverlaySpace(): Promise<void> {
  if (!overlay || overlay.isDestroyed()) return
  const info = (await overlay.webContents.executeJavaScript(
    '({ width: window.innerWidth, height: window.innerHeight })'
  )) as { width: number; height: number }
  const physical = physicalScreen()
  const dipDistance = Math.abs(info.width - overlayDip.width) + Math.abs(info.height - overlayDip.height)
  const physicalDistance =
    Math.abs(info.width - physical.width) + Math.abs(info.height - physical.height)
  overlayCssIsPhysical = physicalDistance <= dipDistance
}

function sendControl(channel: string, payload: unknown): void {
  if (!control || control.isDestroyed()) return
  control.webContents.send(channel, payload)
}

function layoutOverlay(): void {
  if (!overlay || overlay.isDestroyed()) return
  overlayDip = dipVirtualBounds()
  overlay.setBounds(overlayDip)
}

function pushOverlay(): void {
  if (!overlay || overlay.isDestroyed()) return
  const cursor = toOverlayPoint(pointerPhysical())
  const frame = toOverlayRect(playArea)
  const model: OverlayModel = {
    showFrame,
    frame,
    mark,
    cursor: mark ? cursor : null,
    ghosts: ghosts.map((ghost) => {
      const gx = ghost.x
      const gy = ghost.y
      const visible = gx != null && gy != null
      const point = visible ? toOverlayPoint(project({ x: gx, y: gy }, playArea)) : { x: 0, y: 0 }
      return {
        id: ghost.id,
        name: ghost.name,
        color: typeof ghost.color === 'string' ? ghost.color : '#e2a14a',
        visible,
        x: point.x,
        y: point.y,
        nx: visible ? gx : null,
        ny: visible ? gy : null,
        flash: ghost.pings.length > 0
      }
    })
  }
  overlay.webContents.send(CH.overlay, model)
}

function publishArea(note: string | null = null): void {
  watch.current?.resync()
  sendControl(CH.playArea, playArea)
  sendControl(CH.playNote, note)
  pushOverlay()
}

function validArea(value: unknown): Bounds | null {
  if (!value || typeof value !== 'object') return null
  const area = value as Bounds
  const numbers = [area.x, area.y, area.width, area.height]
  if (!numbers.every((item) => typeof item === 'number' && Number.isFinite(item))) return null
  if (area.width < 40 || area.height < 40 || area.width > 20000 || area.height > 20000) return null
  return { x: area.x, y: area.y, width: area.width, height: area.height }
}

function sanitizeGhosts(value: unknown): GhostUpdate[] {
  if (!Array.isArray(value)) return []
  const next: GhostUpdate[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const ghost = item as GhostUpdate
    if (typeof ghost.id !== 'string' || typeof ghost.name !== 'string') continue
    const x = typeof ghost.x === 'number' && Number.isFinite(ghost.x) ? ghost.x : null
    const y = typeof ghost.y === 'number' && Number.isFinite(ghost.y) ? ghost.y : null
    const pings = Array.isArray(ghost.pings)
      ? ghost.pings.flatMap((ping) => {
          if (!ping || typeof ping.id !== 'string') return []
          if (typeof ping.x !== 'number' || typeof ping.y !== 'number') return []
          if (!Number.isFinite(ping.x) || !Number.isFinite(ping.y)) return []
          return [{ id: ping.id, x: ping.x, y: ping.y }]
        })
      : []
    next.push({
      id: ghost.id,
      name: ghost.name.slice(0, 40),
      color: typeof ghost.color === 'string' ? ghost.color : '#e2a14a',
      x,
      y,
      pings
    })
  }
  return next
}

async function captureWindow(): Promise<void> {
  const point = pointerPhysical()
  const result = await windowAtPoint(point.x, point.y)
  if (!result.window) {
    publishArea(result.note)
    return
  }
  const raw = result.window
  playArea = { x: raw.x, y: raw.y, width: raw.width, height: raw.height }
  publishArea(result.window.title)
}

async function beginMark(kind: MarkKind): Promise<void> {
  const token = ++markToken
  sendControl(CH.playMarking, true)
  for (const count of [3, 2, 1]) {
    if (token !== markToken) return
    mark = { kind, count }
    pushOverlay()
    await delay(700)
  }
  if (token !== markToken) return
  if (kind === 'window') await captureWindow()
  else {
    playArea = applyCorner(playArea, kind, pointerPhysical())
    publishArea(null)
  }
  mark = null
  sendControl(CH.playMarking, false)
  pushOverlay()
}

function displays(): DisplayInfo[] {
  const primary = screen.getPrimaryDisplay().id
  return screen.getAllDisplays().map((display) => ({
    id: display.id,
    label: display.label || `Display ${display.id}`,
    primary: display.id === primary,
    bounds: physicalBounds(display.bounds)
  }))
}

function preloadPath(): string {
  return join(__dirname, '../preload/index.js')
}

function loadPage(win: BrowserWindow, page: string): void {
  const splitAt = page.indexOf('?')
  const file = splitAt === -1 ? page : page.slice(0, splitAt)
  const search = splitAt === -1 ? '' : page.slice(splitAt + 1)
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    const base = process.env['ELECTRON_RENDERER_URL']
    const url = new URL(file, base.endsWith('/') ? base : `${base}/`)
    if (search) url.search = search
    void win.loadURL(url.toString())
    return
  }
  void win.loadFile(join(__dirname, '../renderer', file), search ? { search } : undefined)
}

function createControl(): void {
  control = new BrowserWindow({
    width: 420,
    height: 760,
    minWidth: 380,
    minHeight: 520,
    show: false,
    autoHideMenuBar: true,
    title: 'Ghostlink',
    backgroundColor: '#141210',
    icon,
    webPreferences: {
      preload: preloadPath(),
      sandbox: false
    }
  })

  control.on('ready-to-show', () => {
    control?.show()
  })

  control.webContents.setWindowOpenHandler((details) => {
    void shell.openExternal(details.url)
    return { action: 'deny' }
  })

  control.on('closed', () => {
    control = null
    app.quit()
  })

  loadPage(control, 'index.html')
}

function createOverlay(): void {
  overlayDip = dipVirtualBounds()
  overlay = new BrowserWindow({
    x: overlayDip.x,
    y: overlayDip.y,
    width: overlayDip.width,
    height: overlayDip.height,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    focusable: false,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    hasShadow: false,
    roundedCorners: false,
    title: 'Ghostlink overlay',
    webPreferences: {
      preload: preloadPath(),
      sandbox: false
    }
  })
  overlay.setIgnoreMouseEvents(true)
  overlay.setAlwaysOnTop(true, 'screen-saver')
  overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  overlay.on('ready-to-show', () => {
    layoutOverlay()
    overlay?.showInactive()
    void syncOverlaySpace().then(() => pushOverlay())
  })
  overlay.webContents.on('did-finish-load', () => {
    void syncOverlaySpace().then(() => pushOverlay())
  })
  overlay.on('closed', () => {
    overlay = null
  })
  loadPage(overlay, 'overlay.html')
  layoutOverlay()
}

function showPad(win: BrowserWindow): void {
  const area = screen.getPrimaryDisplay().workArea
  const width = 720
  const height = 520
  win.setBounds({
    x: Math.round(area.x + Math.max(0, (area.width - width) / 2)),
    y: Math.round(area.y + Math.max(0, (area.height - height) / 2)),
    width,
    height
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  win.show()
  win.moveTop()
  win.focus()
}

function openPad(launch: PadLaunch): void {
  const page = `pad.html?${new URLSearchParams({ code: launch.code }).toString()}`
  if (pad && !pad.isDestroyed()) {
    loadPage(pad, page)
    showPad(pad)
    return
  }
  pad = new BrowserWindow({
    width: 720,
    height: 520,
    minWidth: 480,
    minHeight: 360,
    show: false,
    title: 'Ghostlink test seat',
    backgroundColor: '#141210',
    autoHideMenuBar: true,
    icon,
    webPreferences: {
      preload: preloadPath(),
      sandbox: false
    }
  })
  pad.on('ready-to-show', () => {
    if (pad && !pad.isDestroyed()) showPad(pad)
  })
  pad.on('closed', () => {
    pad = null
  })
  loadPage(pad, page)
}

function registerIpc(): void {
  ipcMain.handle(CH.displays, () => displays())
  ipcMain.handle(CH.playGet, () => playArea)
  ipcMain.handle(CH.playUseDisplay, (_event, id: number) => {
    const display = screen.getAllDisplays().find((item) => item.id === id)
    if (!display) return null
    playArea = physicalBounds(display.bounds)
    publishArea(null)
    return playArea
  })
  ipcMain.handle(CH.playRestore, (_event, area: unknown) => {
    const next = validArea(area)
    if (!next) return false
    playArea = next
    publishArea(null)
    return true
  })
  ipcMain.handle(CH.playMark, async (_event, kind: MarkKind) => {
    await beginMark(kind)
  })
  ipcMain.handle(CH.hook, () => watch.current?.status ?? { live: false, detail: 'Not ready' })
  ipcMain.handle(CH.pad, (_event, launch: PadLaunch) => {
    if (!launch || typeof launch.code !== 'string') return
    openPad({ code: launch.code })
  })
  ipcMain.on(CH.ghosts, (event, payload: unknown) => {
    if (event.sender.id !== control?.webContents.id) return
    ghosts = sanitizeGhosts(payload)
    pushOverlay()
  })
  ipcMain.on(CH.frame, (event, show: boolean) => {
    if (event.sender.id !== control?.webContents.id) return
    showFrame = Boolean(show)
    pushOverlay()
  })
}

function registerShortcuts(hookLive: boolean): void {
  globalShortcut.register('Control+Alt+1', () => {
    playArea = applyCorner(playArea, 'top-left', pointerPhysical())
    publishArea(null)
  })
  globalShortcut.register('Control+Alt+2', () => {
    playArea = applyCorner(playArea, 'bottom-right', pointerPhysical())
    publishArea(null)
  })
  if (!hookLive) {
    globalShortcut.register('Control+Alt+P', () => {
      const normalized = normalize(pointerPhysical(), playArea)
      if (!isInside(normalized)) return
      sendControl(CH.click, {
        x: quantize(normalized.x),
        y: quantize(normalized.y),
        inside: true
      })
    })
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('app.ghostlink.desktop')
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  calibratePointer()
  playArea = physicalBounds(screen.getPrimaryDisplay().bounds)

  registerIpc()
  createControl()
  createOverlay()

  watch.current = startPointerWatch({
    getArea: () => playArea,
    isMarking: () => mark !== null,
    onSample: (sample) => sendControl(CH.sample, sample),
    onClick: (sample) => sendControl(CH.click, sample),
    onCursor: () => pushOverlay()
  })
  registerShortcuts(watch.current.status.live)

  screen.on('display-metrics-changed', () => {
    layoutOverlay()
    pushOverlay()
  })
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  watch.current?.stop()
})

app.on('window-all-closed', () => {
  app.quit()
})
