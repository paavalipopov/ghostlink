// Real Tauri + WebView2 checks with isolated preferences and synthetic native IPC input.
// This does not move/click the system mouse, contact relays, or test real Magpie/game rendering.
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
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
        '--no-proxy-server --host-resolver-rules="MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE *.localhost" ' +
        '--disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows'
    }
  }
)
let launchError
child.on('error', (error) => {
  launchError = error
})
const connections = []

async function pages() {
  if (launchError) throw launchError
  const targets = await (
    await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1500) })
  ).json()
  return targets.filter(
    (page) => page.type === 'page' && new URL(page.url).hostname === 'tauri.localhost'
  )
}

async function expectPages(...paths) {
  await until(
    `only ${paths.join(', ')} open`,
    async () =>
      JSON.stringify((await pages()).map((page) => new URL(page.url).pathname).sort()) ===
      JSON.stringify(paths.toSorted())
  )
}

// Send the title-bar Close message only to a top-level window owned by this test instance.
function closeNativeWindow(title) {
  execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `
    $ErrorActionPreference = 'Stop'
    Add-Type -Namespace DesktopCheck -Name Native -MemberDefinition @'
      [DllImport("user32.dll", CharSet=CharSet.Unicode)]
      public static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, IntPtr cls, string title);
      [DllImport("user32.dll")]
      public static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
      [DllImport("user32.dll")]
      public static extern bool PostMessage(IntPtr window, uint msg, IntPtr wp, IntPtr lp);
'@
    $handle = [IntPtr]::Zero
    do {
      $handle = [DesktopCheck.Native]::FindWindowEx([IntPtr]::Zero, $handle, [IntPtr]::Zero, $env:GHOSTLINK_TEST_WINDOW)
      if ($handle -eq [IntPtr]::Zero) { throw 'The test window was not found' }
      [uint32]$owner = 0
      [void][DesktopCheck.Native]::GetWindowThreadProcessId($handle, [ref]$owner)
    } until ($owner -eq [uint32]$env:GHOSTLINK_TEST_PID)
    if (!([DesktopCheck.Native]::PostMessage($handle, 0x10, [IntPtr]::Zero, [IntPtr]::Zero))) {
      throw 'Could not close the test window'
    }
  `
    ],
    {
      windowsHide: true,
      timeout: 10000,
      env: { ...process.env, GHOSTLINK_TEST_WINDOW: title, GHOSTLINK_TEST_PID: String(child.pid) }
    }
  )
}

async function attach(path) {
  const page = await until(`WebView ${path}`, async () =>
    (await pages()).find((page) => new URL(page.url).pathname === path)
  )
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
    async request(method, params) {
      const result = await new Promise((done, fail) => {
        const id = ++sequence
        const timer = setTimeout(() => {
          pending.delete(id)
          fail(new Error(`WebView ${method} timed out`))
        }, 5000)
        pending.set(id, (response) => {
          pending.delete(id)
          clearTimeout(timer)
          if (response.error || response.result?.exceptionDetails)
            fail(new Error(JSON.stringify(response)))
          else done(response.result)
        })
        ws.send(
          JSON.stringify({
            id,
            method,
            params
          })
        )
      })
      return result
    },
    async eval(expression) {
      const result = await this.request('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true
      })
      return result.result.value
    },
    async screenshot(path) {
      const result = await this.request('Page.captureScreenshot', { format: 'png' })
      await writeFile(path, Buffer.from(result.data, 'base64'))
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
  const permanent = ['/', '/overlay.html']
  await expectPages(...permanent)
  assert.equal(await overlay.invoke('fullscreen_exit_hint'), null)
  await assert.rejects(panel.invoke('fullscreen_exit_hint'), /Only the overlay/)
  assert.equal(
    await overlay.eval(`!!document.querySelector('[data-testid="fullscreen-exit-hint"]')`),
    false,
    'The exit hint stays hidden outside fullscreen'
  )
  await until('panel controls', () => panel.eval(`!!document.querySelector('${toggle}')`))
  await until('compact panel width', () => panel.eval('Math.abs(innerWidth - 266) <= 1'))
  if (process.env.GHOSTLINK_PANEL_SCREENSHOT) {
    await panel.screenshot(resolve(process.env.GHOSTLINK_PANEL_SCREENSHOT))
  }
  const initial = await panel.eval(metrics)
  assert.equal(initial.on, 'true')
  assert.equal(initial.overflow, false)
  assert.equal(
    await panel.eval(`Array.from(document.querySelectorAll('button, input, select')).every(control => {
      const rect = control.getBoundingClientRect()
      return rect.x >= 0 && rect.right <= innerWidth + 1 && control.scrollWidth <= control.clientWidth + 1
        && Array.from(control.querySelectorAll('span')).every(label => label.scrollWidth <= label.clientWidth + 1)
    })`),
    true,
    'Controls and their labels must fit inside the narrower panel'
  )
  assert.ok(
    Math.abs(initial.heading.center - initial.row.center) < 0.75,
    'Shared area must stay centered in its row'
  )
  assert.ok(
    Math.abs(initial.button.right - initial.row.right) < 0.75,
    'Frame button belongs in the right-hand space'
  )
  assert.ok(initial.button.x > initial.heading.right)
  assert.equal(await panel.eval(`document.querySelector('h2').textContent.trim()`), 'Shared area')
  assert.equal(await panel.eval(`document.body.innerText.includes('Dev fullscreen')`), false)
  const displayCount = (await panel.invoke('controls')).displays.length
  assert.equal(
    await panel.eval(`!!document.querySelector('[aria-label="Display"]')`),
    displayCount > 1
  )
  assert.equal(
    await panel.eval(
      `document.querySelector('[data-testid="full-screen"]').textContent.includes('Entire display')`
    ),
    true
  )
  assert.equal(
    await panel.eval(
      `document.querySelector('[data-testid="toggle-fullscreen"]').getAttribute('aria-pressed')`
    ),
    'false'
  )
  const fullscreen = await panel.eval(`(() => {
    const button = document.querySelector('[data-testid="toggle-fullscreen"]')
    const row = button.parentElement.getBoundingClientRect()
    const rect = button.getBoundingClientRect()
    return { x: rect.x, right: rect.right, rowLeft: row.x, headingLeft: document.querySelector('h2').getBoundingClientRect().x }
  })()`)
  assert.ok(
    Math.abs(fullscreen.x - fullscreen.rowLeft) < 0.75,
    'Fullscreen toggle belongs on the left'
  )
  assert.ok(
    fullscreen.right < fullscreen.headingLeft,
    'Fullscreen toggle stays left of the heading'
  )

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
  await assert.rejects(panel.invoke('open_test_pad', { code: 'bad' }), /Invalid test secret/)
  await assert.rejects(panel.invoke('begin_drag', { bounds: { ...display, width: 1 } }))
  await expectPages(...permanent)
  for (let pass = 0; pass < 2; pass++) {
    await panel.invoke('prepare_pick_marker')
    await panel.invoke('set_pick_count', { count: 3 })
    await expectPages(...permanent, '/pick-marker.html')
    await panel.invoke('set_pick_count', { count: null })
    await expectPages(...permanent)
  }
  await panel.invoke('set_pick_count', { count: null })
  for (const commit of [true, false]) {
    await panel.invoke('begin_drag', { bounds: display })
    const picker = await attach('/picker.html')
    await until('interactive picker', () => picker.eval("!!document.querySelector('.picker')"))
    if (commit) {
      // Exercise the real renderer's pointer capture and commit handlers.
      await picker.request('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x: 30,
        y: 30,
        button: 'left',
        buttons: 1,
        clickCount: 1
      })
      await picker.request('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: 180,
        y: 160,
        buttons: 1
      })
      await picker.request('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x: 180,
        y: 160,
        button: 'left',
        clickCount: 1
      })
    } else {
      await picker.eval(
        "setTimeout(() => window.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape'})), 0)"
      )
    }
    await expectPages(...permanent)
    if (commit)
      await until('drawn overlay', () =>
        overlay.eval('Math.abs(innerWidth-150)<=1 && Math.abs(innerHeight-130)<=1')
      )
    else
      assert.ok(await overlay.eval('Math.abs(innerWidth-150)<=1 && Math.abs(innerHeight-130)<=1'))
  }
  await panel.invoke('restore_area', { bounds: area })
  await Promise.all(
    Array.from({ length: 3 }, () => panel.invoke('open_test_pad', { code: 'first-local-test' }))
  )
  await expectPages(...permanent, '/test-pad.html')
  const firstPad = await attach('/test-pad.html')
  await until('test pad initialized', () =>
    firstPad.eval("!!document.querySelector('[data-testid=pad-area]')")
  )
  assert.equal(await firstPad.invoke('test_pad_session'), 'first-local-test')
  await firstPad.eval(
    "setTimeout(() => window.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape'})), 0)"
  )
  await expectPages(...permanent)
  await panel.invoke('open_test_pad', { code: 'second-local-test' })
  const pad = await attach('/test-pad.html')
  assert.equal(await pad.invoke('test_pad_session'), 'second-local-test')
  console.log(
    'PASS: temporary pickers and trackpad open on demand, release their WebViews and reopen with the correct area and session.'
  )
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
  closeNativeWindow('Ghostlink Test Trackpad')
  await expectPages(...permanent)
  await panel.eval("document.querySelector('[data-testid=drag-frame]').click()")
  await expectPages(...permanent, '/picker.html')
  closeNativeWindow('Ghostlink Frame Picker')
  await expectPages(...permanent)
  await until('native close restores panel controls', () =>
    panel.eval("!document.querySelector('[data-testid=drag-frame]').disabled")
  )
  await panel.eval("document.querySelector('[data-testid=open-pad]').click()")
  const reopenedPad = await attach('/test-pad.html')
  await until('panel starts a fresh private session', async () => {
    const session = await reopenedPad.invoke('test_pad_session')
    return session && session !== 'second-local-test'
  })
  assert.deepEqual(await reopenedPad.invoke('test_pad_area'), area)
  closeNativeWindow('Ghostlink Test Trackpad')
  await expectPages(...permanent)
  console.log(
    'PASS: native Close releases both windows, restores the panel and preserves the shared area.'
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

  await panel.invoke('prepare_pick_marker')
  await panel.invoke('set_pick_count', { count: 2 })
  await until('countdown appears', () =>
    overlay.eval("!!document.querySelector('[data-testid=pick-count]')")
  )
  await panel.invoke('open_test_pad', { code: 'interrupted-local-test' })
  await panel.invoke('begin_drag', { bounds: display })
  await expectPages(...permanent, '/test-pad.html', '/pick-marker.html', '/picker.html')
  await panel.eval('window.__beforeTestReload=true; setTimeout(()=>location.reload(),0)')
  await until('frame preference after panel reload', () =>
    panel.eval(
      `!window.__beforeTestReload && document.querySelector('${toggle}')?.getAttribute('aria-pressed') === 'false'`
    )
  )
  await until('frame remains hidden after reload', () =>
    overlay.eval("!document.querySelector('.frame')")
  )
  await expectPages(...permanent)
  await until('interrupted countdown cleared', () =>
    overlay.eval("!document.querySelector('[data-testid=pick-count]')")
  )
  console.log(
    'PASS: Panel reload releases interrupted tools, clears the countdown and preserves the saved frame preference.'
  )
  await panel.request('Network.enable', {})
  await panel.request('Network.setBlockedURLs', { urls: ['wss://*'] })
  await panel.eval(`document.querySelector('[aria-label="Pick a name"]').click()`)
  await panel.eval(`document.querySelector('[aria-label="Make a code"]').click()`)
  const secret = await panel.eval("document.querySelector('#code').value")
  const connect = '[data-testid="connect"]'
  await until('Connect enabled', () => panel.eval(`!document.querySelector('${connect}').disabled`))
  await panel.eval(`document.querySelector('${connect}').click()`)
  await until('active secret locked', () =>
    panel.eval(`document.querySelector('#code').readOnly &&
    document.querySelector('[aria-label="Make a code"]').disabled`)
  )
  await panel.eval(`document.querySelector('[aria-label="Make a code"]').click()`)
  assert.equal(await panel.eval("document.querySelector('#code').value"), secret)
  await panel.eval(`document.querySelector('${connect}').click()`)
  await until('secret can change after disconnect', () =>
    panel.eval(`!document.querySelector('#code').readOnly &&
    !document.querySelector('[aria-label="Make a code"]').disabled`)
  )
  console.log(
    'PASS: The active secret is copyable, stays locked while waiting and unlocks on disconnect.'
  )
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
