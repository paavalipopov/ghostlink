import {
  app,
  BrowserWindow,
  desktopCapturer,
  globalShortcut,
  ipcMain,
  screen,
  shell,
  type Display
} from 'electron'
import { join } from 'path'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { CH, type PadLaunch } from '../shared/bridge'
import { applyCorner, isInside, normalize, project, quantize, type Bounds } from '../shared/coords'
import {
  MAX_PEERS,
  MAX_PING_ID,
  MAX_PINGS,
  unitPoint,
  type DisplayInfo,
  type FramePick,
  type GhostUpdate,
  type MarkKind,
  type MarkState,
  type OverlayModel
} from '../shared/protocol'
import { windowAtPoint } from './desktop-windows'
import { startPointerWatch } from './input'
import { calibratePointer, physicalBounds, pointerPhysical } from './pixels'
import { ensureWin32, stopWin32 } from './win32'

if (process.env.GHOSTLINK_DEBUG === '1') {
  app.commandLine.appendSwitch('remote-debugging-port', '9333')
  app.commandLine.appendSwitch('remote-debugging-address', '127.0.0.1')
}

let control: BrowserWindow | null = null
let overlay: BrowserWindow | null = null
let pad: BrowserWindow | null = null
let playArea: Bounds = { x: 0, y: 0, width: 800, height: 600 }
let showFrame = true
let shareSamples = false
let ghosts: GhostUpdate[] = []
let mark: MarkState = null
let markToken = 0
let picking = false
let gesture = false
let picker: BrowserWindow | null = null
let pendingShot: { displayId: number; image: string } | null = null
let pickWait: ((pick: FramePick | null) => void) | null = null
let framedDisplay: Display | null = null
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
  for (let attempt = 0; attempt < 12; attempt++) {
    let info: { width: number; height: number }
    try {
      info = (await overlay.webContents.executeJavaScript(
        '({ width: window.innerWidth, height: window.innerHeight })'
      )) as { width: number; height: number }
    } catch {
      return
    }
    const physical = physicalScreen()
    const dipDistance =
      Math.abs(info.width - overlayDip.width) + Math.abs(info.height - overlayDip.height)
    const physicalDistance =
      Math.abs(info.width - physical.width) + Math.abs(info.height - physical.height)
    if (Math.min(dipDistance, physicalDistance) <= 48) {
      overlayCssIsPhysical = physicalDistance < dipDistance
      return
    }
    await delay(40)
  }
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
    picking,
    cursor: mark ? cursor : null,
    ghosts: ghosts.map((ghost) => {
      const gx = ghost.x
      const gy = ghost.y
      const visible = gx != null && gy != null
      const point = visible ? toOverlayPoint(project({ x: gx, y: gy }, playArea)) : { x: 0, y: 0 }
      const flash = ghost.pings.length > 0
      return {
        id: ghost.id,
        name: ghost.name,
        color: typeof ghost.color === 'string' ? ghost.color : '#e2a14a',
        visible,
        x: point.x,
        y: point.y,
        nx: visible ? gx : null,
        ny: visible ? gy : null,
        flash,
        flashId: flash ? ghost.pings[ghost.pings.length - 1].id : ''
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
    if (next.length >= MAX_PEERS) break
    const placed = unitPoint(ghost.x, ghost.y)
    const pings = Array.isArray(ghost.pings)
      ? ghost.pings
          .flatMap((ping) => {
            if (!ping || typeof ping.id !== 'string') return []
            const point = unitPoint(ping.x, ping.y)
            if (!point) return []
            return [{ id: ping.id.slice(0, MAX_PING_ID), x: point.x, y: point.y }]
          })
          .slice(0, MAX_PINGS)
      : []
    next.push({
      id: ghost.id,
      name: ghost.name.slice(0, 40),
      color: typeof ghost.color === 'string' ? ghost.color : '#e2a14a',
      x: placed ? placed.x : null,
      y: placed ? placed.y : null,
      pings
    })
  }
  return next
}

async function captureWindow(): Promise<void> {
  const point = pointerPhysical()
  const cover = overlay && !overlay.isDestroyed() && overlay.isVisible()
  const seatRaised = Boolean(pad && !pad.isDestroyed())
  if (cover) overlay?.hide()
  if (seatRaised) pad?.setAlwaysOnTop(false)
  try {
    await delay(60)
    const result = await windowAtPoint(point.x, point.y)
    if (!result.window) {
      publishArea(result.note)
      return
    }
    const raw = result.window
    playArea = { x: raw.x, y: raw.y, width: raw.width, height: raw.height }
    publishArea(result.window.title)
  } finally {
    if (seatRaised && pad && !pad.isDestroyed()) pad.setAlwaysOnTop(true, 'screen-saver')
    if (cover && overlay && !overlay.isDestroyed()) overlay.showInactive()
  }
}

function roundArea(area: Bounds): Bounds {
  const x = Math.round(area.x)
  const y = Math.round(area.y)
  const right = Math.round(area.x + area.width)
  const bottom = Math.round(area.y + area.height)
  return { x, y, width: Math.max(0, right - x), height: Math.max(0, bottom - y) }
}

function settlePick(pick: FramePick | null): void {
  const wait = pickWait
  if (!wait) return
  pickWait = null
  wait(pick)
}

function closePicker(): void {
  const win = picker
  picker = null
  if (win && !win.isDestroyed()) win.close()
}

function parsePick(value: unknown): FramePick | null {
  if (!value || typeof value !== 'object') return null
  const pick = value as FramePick
  if (pick.space === 'display') {
    const numbers = [pick.displayId, pick.x, pick.y, pick.width, pick.height]
    if (!numbers.every((item) => typeof item === 'number' && Number.isFinite(item))) return null
    if (pick.width <= 0 || pick.height <= 0) return null
    return {
      space: 'display',
      displayId: pick.displayId,
      x: Math.min(1, Math.max(0, pick.x)),
      y: Math.min(1, Math.max(0, pick.y)),
      width: Math.min(1, pick.width),
      height: Math.min(1, pick.height)
    }
  }
  if (pick.space === 'overlay') {
    const numbers = [pick.x1, pick.y1, pick.x2, pick.y2]
    if (!numbers.every((item) => typeof item === 'number' && Number.isFinite(item))) return null
    const clamp = (value: number): number => Math.min(1, Math.max(0, value))
    return {
      space: 'overlay',
      x1: clamp(pick.x1),
      y1: clamp(pick.y1),
      x2: clamp(pick.x2),
      y2: clamp(pick.y2)
    }
  }
  return null
}

function keepArea(area: Bounds): void {
  if (area.width < 40 || area.height < 40) {
    publishArea('Drag a larger rectangle.')
    return
  }
  playArea = area
  publishArea(null)
}

function applyDisplayPick(display: Display, pick: Extract<FramePick, { space: 'display' }>): void {
  const bounds = physicalBounds(display.bounds)
  keepArea(
    roundArea({
      x: bounds.x + pick.x * bounds.width,
      y: bounds.y + pick.y * bounds.height,
      width: pick.width * bounds.width,
      height: pick.height * bounds.height
    })
  )
}

function applyOverlayPick(pick: Extract<FramePick, { space: 'overlay' }>): void {
  const display = framedDisplay ?? screen.getPrimaryDisplay()
  applyDisplayPick(display, {
    space: 'display',
    displayId: display.id,
    x: Math.min(pick.x1, pick.x2),
    y: Math.min(pick.y1, pick.y2),
    width: Math.abs(pick.x2 - pick.x1),
    height: Math.abs(pick.y2 - pick.y1)
  })
}

async function captureDisplay(display: Display): Promise<string | null> {
  const physical = physicalBounds(display.bounds)
  const longEdge = Math.max(physical.width, physical.height)
  const scale = longEdge > 960 ? 960 / longEdge : 1
  const capture = desktopCapturer
    .getSources({
      types: ['screen'],
      thumbnailSize: {
        width: Math.max(1, Math.round(physical.width * scale)),
        height: Math.max(1, Math.round(physical.height * scale))
      }
    })
    .then((sources) => {
      const wanted = String(display.id)
      const source = sources.find((item) => item.display_id === wanted) ?? sources[0]
      if (!source || source.thumbnail.isEmpty()) return null
      const size = source.thumbnail.getSize()
      if (size.width < 320 || size.height < 200) return null
      const aspect = size.width / Math.max(1, size.height)
      const wantedAspect = physical.width / Math.max(1, physical.height)
      if (Math.abs(aspect - wantedAspect) > 0.08) return null
      const bitmap = source.thumbnail.toBitmap()
      let peak = 0
      for (let i = 0; i < bitmap.length; i += 64) {
        peak = Math.max(peak, bitmap[i] ?? 0, bitmap[i + 1] ?? 0, bitmap[i + 2] ?? 0)
        if (peak > 8) break
      }
      if (peak <= 8) return null
      return source.thumbnail.toDataURL()
    })
    .catch(() => null)
  return Promise.race([
    capture,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 12000))
  ])
}

function createPicker(display: Display): BrowserWindow {
  const win = new BrowserWindow({
    x: display.bounds.x,
    y: display.bounds.y,
    width: display.bounds.width,
    height: display.bounds.height,
    frame: false,
    show: false,
    transparent: false,
    backgroundColor: '#000000',
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    focusable: true,
    roundedCorners: false,
    thickFrame: false,
    title: 'Ghostlink frame',
    webPreferences: windowPrefs()
  })
  denyNavigation(win)
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setBounds(display.bounds)
  return win
}

function loadPageAndWait(win: BrowserWindow, page: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = (): void => {
      win.webContents.removeListener('did-fail-load', fail)
      resolve()
    }
    const fail = (): void => {
      win.webContents.removeListener('did-finish-load', done)
      reject(new Error('load failed'))
    }
    win.webContents.once('did-finish-load', done)
    win.webContents.once('did-fail-load', fail)
    loadPage(win, page)
  })
}

async function runScreenshotPick(display: Display, image: string): Promise<FramePick | null> {
  if (overlay && !overlay.isDestroyed()) overlay.hide()
  const win = createPicker(display)
  picker = win
  pendingShot = { displayId: display.id, image }
  const result = new Promise<FramePick | null>((resolve) => {
    pickWait = resolve
  })
  win.on('closed', () => {
    if (picker === win) picker = null
    settlePick(null)
  })
  try {
    await loadPageAndWait(win, 'select.html')
  } catch {
    settlePick(null)
    return result
  }
  if (win.isDestroyed()) return result
  win.setBounds(display.bounds)
  win.show()
  win.moveTop()
  win.focus()
  return result
}

async function runOverlayPick(display: Display): Promise<FramePick | null> {
  if (!overlay || overlay.isDestroyed()) return null
  framedDisplay = display
  overlay.setBounds(display.bounds)
  picking = true
  overlay.setIgnoreMouseEvents(false)
  overlay.setFocusable(true)
  pushOverlay()
  overlay.show()
  overlay.moveTop()
  overlay.focus()
  return new Promise((resolve) => {
    pickWait = resolve
  })
}

async function beginFrameDrag(displayId: number): Promise<void> {
  if (gesture || mark) return
  gesture = true
  const seatRaised = Boolean(pad && !pad.isDestroyed())
  const overlayVisible = Boolean(overlay && !overlay.isDestroyed() && overlay.isVisible())
  if (seatRaised) pad?.setAlwaysOnTop(false)
  sendControl(CH.playMarking, true)
  sendControl(CH.playNote, 'Preparing the picture.')
  try {
    const display =
      screen.getAllDisplays().find((item) => item.id === displayId) ?? screen.getPrimaryDisplay()
    framedDisplay = display
    if (overlay && !overlay.isDestroyed()) overlay.hide()
    const image = await captureDisplay(display)
    sendControl(
      CH.playNote,
      image ? 'Drag across the screenshot, then release.' : 'Drag across the picture, then release.'
    )
    const pick = image ? await runScreenshotPick(display, image) : await runOverlayPick(display)
    if (!pick) {
      sendControl(CH.playNote, null)
      return
    }
    if (pick.space === 'display') applyDisplayPick(display, pick)
    else applyOverlayPick(pick)
  } finally {
    picking = false
    framedDisplay = null
    pendingShot = null
    closePicker()
    if (overlay && !overlay.isDestroyed()) {
      overlay.setIgnoreMouseEvents(true)
      overlay.setFocusable(false)
      layoutOverlay()
      if (overlayVisible) overlay.showInactive()
      await syncOverlaySpace()
    }
    if (seatRaised && pad && !pad.isDestroyed()) pad.setAlwaysOnTop(true, 'screen-saver')
    gesture = false
    sendControl(CH.playMarking, false)
    pushOverlay()
  }
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

function windowPrefs(): { preload: string; contextIsolation: true; sandbox: true } {
  return {
    preload: preloadPath(),
    contextIsolation: true,
    sandbox: true
  }
}

function denyNavigation(win: BrowserWindow): void {
  win.webContents.on('will-navigate', (event) => {
    event.preventDefault()
  })
}

function fromControl(senderId: number): boolean {
  return senderId === control?.webContents.id
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

function showControl(): void {
  if (!control || control.isDestroyed() || control.isVisible()) return
  control.show()
}

function createControl(): void {
  control = new BrowserWindow({
    width: 315,
    height: 378,
    useContentSize: true,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    autoHideMenuBar: true,
    title: 'Ghostlink',
    backgroundColor: '#141210',
    icon,
    webPreferences: windowPrefs()
  })

  control.on('ready-to-show', () => {
    setTimeout(() => showControl(), 2500)
  })

  denyNavigation(control)
  control.webContents.setWindowOpenHandler((details) => {
    try {
      const url = new URL(details.url)
      if (url.protocol === 'https:') void shell.openExternal(url.toString())
    } catch {
      // Leave a bad URL closed.
    }
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
    thickFrame: false,
    title: 'Ghostlink overlay',
    webPreferences: windowPrefs()
  })
  denyNavigation(overlay)
  overlay.setIgnoreMouseEvents(true)
  overlay.webContents.setBackgroundThrottling(false)
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
    settlePick(null)
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
    webPreferences: windowPrefs()
  })
  denyNavigation(pad)
  pad.webContents.setBackgroundThrottling(false)
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
  ipcMain.handle(CH.playUseDisplay, (event, id: number) => {
    if (!fromControl(event.sender.id)) return null
    const display = screen.getAllDisplays().find((item) => item.id === id)
    if (!display) return null
    playArea = physicalBounds(display.bounds)
    publishArea(null)
    return playArea
  })
  ipcMain.handle(CH.playRestore, (event, area: unknown) => {
    if (!fromControl(event.sender.id)) return false
    const next = validArea(area)
    if (!next) return false
    playArea = next
    publishArea(null)
    return true
  })
  ipcMain.handle(CH.playMark, async (event, kind: MarkKind) => {
    if (event.sender.id !== control?.webContents.id) return
    if (gesture || mark) return
    gesture = true
    try {
      await beginMark(kind)
    } finally {
      gesture = false
    }
  })
  ipcMain.handle(CH.playPick, async (event, displayId: number) => {
    if (event.sender.id !== control?.webContents.id) return
    if (typeof displayId !== 'number' || !Number.isFinite(displayId)) return
    await beginFrameDrag(displayId)
  })
  ipcMain.handle(CH.playPickShot, (event) => {
    if (event.sender.id !== picker?.webContents.id) return null
    return pendingShot
  })
  ipcMain.handle(CH.playPickFinish, (event, payload: unknown) => {
    const sender = event.sender.id
    if (sender !== picker?.webContents.id && sender !== overlay?.webContents.id) return
    settlePick(parsePick(payload))
  })
  ipcMain.handle(CH.hook, () => watch.current?.status ?? { live: false, detail: 'Not ready' })
  ipcMain.handle(CH.pad, (event, launch: PadLaunch) => {
    if (!fromControl(event.sender.id)) return
    if (!launch || typeof launch.code !== 'string') return
    openPad({ code: launch.code })
  })
  ipcMain.on(CH.ghosts, (event, payload: unknown) => {
    if (event.sender.id !== control?.webContents.id) return
    ghosts = sanitizeGhosts(payload)
    pushOverlay()
  })
  ipcMain.on(CH.linked, (event, linked: boolean) => {
    if (!fromControl(event.sender.id)) return
    shareSamples = Boolean(linked)
  })
  ipcMain.on(CH.fit, (event, size: unknown) => {
    if (!fromControl(event.sender.id) || !control || control.isDestroyed()) return
    if (!size || typeof size !== 'object') return
    const next = size as { width?: unknown; height?: unknown }
    if (typeof next.width !== 'number' || typeof next.height !== 'number') return
    if (!Number.isFinite(next.width) || !Number.isFinite(next.height)) return
    const width = Math.round(next.width)
    const height = Math.round(next.height)
    if (width < 240 || height < 200 || width > 640 || height > 900) return
    const [currentWidth, currentHeight] = control.getContentSize()
    if (currentWidth !== width || currentHeight !== height) control.setContentSize(width, height)
    showControl()
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

  playArea = physicalBounds(screen.getPrimaryDisplay().bounds)

  registerIpc()
  createControl()
  createOverlay()

  watch.current = startPointerWatch({
    getArea: () => playArea,
    isMarking: () => mark !== null,
    onSample: (sample) => {
      if (shareSamples) sendControl(CH.sample, sample)
    },
    onClick: (sample) => sendControl(CH.click, sample),
    onCursor: () => pushOverlay()
  })
  registerShortcuts(watch.current.status.live)
  void ensureWin32().then(() => calibratePointer())

  screen.on('display-metrics-changed', () => {
    layoutOverlay()
    pushOverlay()
  })
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  watch.current?.stop()
  stopWin32()
})

app.on('window-all-closed', () => {
  app.quit()
})
