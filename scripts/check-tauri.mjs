// Real Tauri + WebView2 checks with isolated preferences and synthetic native IPC input.
// This does not move/click the system mouse, contact relays, or test real Magpie/game rendering.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { createServer } from 'node:net'
import { resolve } from 'node:path'

if (process.platform !== 'win32')
  throw new Error('This desktop check requires Windows and WebView2.')

const sleep = (ms) => new Promise((done) => setTimeout(done, ms))
async function until(label, check, timeout = 15000) {
  const deadline = Date.now() + timeout
  let last
  while (Date.now() < deadline) {
    try {
      const value = await check()
      if (value) return value
    } catch (error) {
      last = error
    }
    await sleep(80)
  }
  throw new Error(`${label} timed out${last ? `: ${last.message}` : ''}`)
}

const reservation = createServer().listen(0, '127.0.0.1')
await once(reservation, 'listening')
const port = reservation.address().port
await new Promise((done) => reservation.close(done))
await mkdir(resolve('out/tauri-check'), { recursive: true })
const profile = await mkdtemp(resolve('out/tauri-check/profile-'))
const child = spawn(
  resolve(
    process.argv[2] ??
      resolve(
        process.env.CARGO_TARGET_DIR ?? 'src-tauri/target',
        'x86_64-pc-windows-msvc/release/ghostlink-tauri-prototype.exe'
      )
  ),
  [],
  {
    windowsHide: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      WEBVIEW2_USER_DATA_FOLDER: profile,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:
        `--remote-debugging-port=${port} --remote-debugging-address=127.0.0.1 ` +
        '--disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows'
    }
  }
)
let launchError
child.on('error', (error) => {
  launchError = error
})
const connections = []

async function attach(path) {
  const page = await until(`WebView ${path}`, async () => {
    if (launchError) throw launchError
    const pages = await (
      await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1500) })
    ).json()
    return pages.find(
      (page) =>
        page.type === 'page' &&
        new URL(page.url).hostname === 'tauri.localhost' &&
        new URL(page.url).pathname === path
    )
  })
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await Promise.race([
    once(ws, 'open'),
    sleep(5000).then(() => {
      throw new Error('WebView socket open timed out')
    })
  ])
  let sequence = 0
  const pending = new Map()
  ws.onmessage = ({ data }) => {
    const response = JSON.parse(data)
    pending.get(response.id)?.(response)
  }
  const connection = {
    close: () => ws.close(),
    async eval(expression) {
      const result = await new Promise((done, fail) => {
        const id = ++sequence
        const timer = setTimeout(() => {
          pending.delete(id)
          fail(new Error('WebView evaluation timed out'))
        }, 5000)
        pending.set(id, (response) => {
          pending.delete(id)
          clearTimeout(timer)
          if (response.error || response.result?.exceptionDetails)
            fail(new Error(JSON.stringify(response)))
          else done(response.result.result.value)
        })
        ws.send(
          JSON.stringify({
            id,
            method: 'Runtime.evaluate',
            params: { expression, returnByValue: true, awaitPromise: true }
          })
        )
      })
      return result
    },
    invoke(command, args = {}) {
      return this.eval(
        `window.__TAURI_INTERNALS__.invoke(${JSON.stringify(command)}, ${JSON.stringify(args)})`
      )
    }
  }
  connections.push(connection)
  return connection
}

const toggle = '[data-testid="toggle-frame"]'
const guest = '[data-testid="peer-pointer"]'
const metrics = `(() => {
  const heading = document.querySelector('h2'), button = document.querySelector('${toggle}');
  const rect = n => { const r=n.getBoundingClientRect(); return { x:r.x, y:r.y, width:r.width, right:r.right, center:r.x+r.width/2 } };
  return { heading:rect(heading), row:rect(heading.parentElement), button:rect(button),
    label:rect(button.querySelector('[data-testid="frame-label"]')), status:rect(button.querySelector('[data-testid="frame-status"]')),
    on:button.getAttribute('aria-pressed'), text:button.textContent, width:innerWidth, height:innerHeight,
    overflow:document.documentElement.scrollWidth>innerWidth || document.documentElement.scrollHeight>innerHeight };
})()`
const pointer = {
  id: 'native-fixture',
  name: 'Native IPC fixture',
  color: '#6cb6d9',
  x: 0.25,
  y: 0.75,
  clickKey: null
}
let panel
try {
  panel = await attach('/')
  const overlay = await attach('/overlay.html')
  const pad = await attach('/test-pad.html')
  await until('panel controls', () => panel.eval(`!!document.querySelector('${toggle}')`))
  const initial = await panel.eval(metrics)
  assert.equal(initial.on, 'true')
  assert.equal(initial.overflow, false)
  assert.ok(
    Math.abs(initial.heading.center - initial.row.center) < 0.75,
    'Shared display must stay centered in its row'
  )
  assert.ok(
    Math.abs(initial.button.right - initial.row.right) < 0.75,
    'Frame button belongs in the right-hand space'
  )
  assert.ok(initial.button.x > initial.heading.right)

  const controls = await panel.invoke('controls')
  assert.equal(controls.desktopAreas, true)
  const display = (controls.displays.find((display) => display.primary) ?? controls.displays[0])
    .bounds
  const width = Math.min(600, Math.floor(display.width * 0.6))
  const height = Math.min(400, Math.floor(display.height * 0.6))
  const area = {
    x: display.x + Math.floor((display.width - width) / 2),
    y: display.y + Math.floor((display.height - height) / 2),
    width,
    height
  }
  const selected = await panel.invoke('restore_area', { bounds: area })
  assert.equal(selected.error, null)
  assert.deepEqual(selected.area, area)
  assert.deepEqual(await pad.invoke('test_pad_area'), area)
  await until('physical overlay placement', async () => {
    const geometry = await overlay.eval(
      '({x:screenX*devicePixelRatio,y:screenY*devicePixelRatio,width:innerWidth*devicePixelRatio,height:innerHeight*devicePixelRatio})'
    )
    return Object.entries(area).every(([edge, value]) => Math.abs(geometry[edge] - value) <= 1)
  })
  assert.equal(await overlay.eval("document.querySelectorAll('.point').length"), 0)
  console.log(
    'PASS: native restore-area IPC places the WebView in physical desktop pixels and starts without overlay pointers.'
  )

  await panel.invoke('set_peer_sharing', { session: 61 })
  await panel.invoke('show_peer_pointers', { session: 61, pointers: [pointer] })
  await until('native fixture renders at the expected viewport location', () =>
    overlay.eval(`(() => {
    const p=document.querySelector('${guest}'); if(!p) return false;
    const r=p.getBoundingClientRect(); return Math.abs(r.x-innerWidth*0.25)<1 && Math.abs(r.y-innerHeight*0.75)<1;
  })()`)
  )

  for (const on of [false, true, false]) {
    await panel.eval(`document.querySelector('${toggle}').click()`)
    await until(`frame ${on ? 'on' : 'off'}`, () =>
      overlay.eval(`!!document.querySelector('.frame') === ${on}`)
    )
    const next = await panel.eval(metrics)
    assert.equal(next.on, String(on))
    for (const part of ['button', 'label', 'status', 'heading'])
      assert.deepEqual(next[part], initial[part], `${part} moved when the frame state changed`)
    assert.deepEqual(
      await pad.invoke('test_pad_area'),
      area,
      'Hiding the border must not replace the native shared area'
    )
    assert.equal(
      await overlay.eval(`document.querySelectorAll('${guest}').length`),
      1,
      'Hiding the border must not hide a guest'
    )
  }
  console.log(
    'PASS: Frame on/off keeps button width, label/status positions, centered heading, native area, and guest visibility stable.'
  )

  await panel.invoke('set_peer_sharing', { session: 62 })
  await until('old guest cleared', () =>
    overlay.eval(`document.querySelectorAll('${guest}').length === 0`)
  )
  await panel.invoke('show_peer_pointers', { session: 61, pointers: [pointer] })
  await sleep(120)
  assert.equal(await overlay.eval(`document.querySelectorAll('${guest}').length`), 0)
  await panel.invoke('show_peer_pointers', { session: 62, pointers: [{ ...pointer, x: -0.1 }] })
  await sleep(120)
  assert.equal(await overlay.eval(`document.querySelectorAll('${guest}').length`), 0)
  await panel.invoke('show_peer_pointers', { session: 62, pointers: [pointer] })
  await until('current session guest renders', () =>
    overlay.eval(`document.querySelectorAll('${guest}').length === 1`)
  )
  console.log(
    'PASS: native IPC ignores stale-session and out-of-range guest input, then accepts current valid input.'
  )

  await panel.eval('window.__beforeTestReload=true; setTimeout(()=>location.reload(),0)')
  await until('frame preference after panel reload', () =>
    panel.eval(
      `!window.__beforeTestReload && document.querySelector('${toggle}')?.getAttribute('aria-pressed') === 'false'`
    )
  )
  await until('frame remains hidden after reload', () =>
    overlay.eval("!document.querySelector('.frame')")
  )
  console.log('PASS: Frame off survives a real panel reload with saved preferences.')
  console.log(`Desktop checks passed. Isolated profile: ${profile}`)
} finally {
  if (panel) await panel.invoke('set_peer_sharing', { session: null }).catch(() => {})
  connections.forEach((connection) => connection.close())
  if (child.pid && child.exitCode === null) {
    const kill = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore'
    })
    await once(kill, 'exit')
  }
}
