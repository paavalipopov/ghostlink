// Real Tauri + WebView2 checks with isolated preferences and synthetic native IPC input.
// This does not move/click the system mouse, contact relays, or test real Magpie/game rendering.
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

// Interactive driver for coordinated local desktop checks. No relay traffic is sent.
const { createInterface } = await import('node:readline')
const { createServer: httpServer } = await import('node:http')
const { writeFile } = await import('node:fs/promises')
const fixture = spawn(resolve('out/fullscreen-host/fullscreen-fixture.exe'), [], {
  windowsHide: true,
  stdio: ['pipe', 'pipe', 'ignore']
})
const queue = [],
  waiting = []
createInterface({ input: fixture.stdout }).on('line', (line) => {
  const value = JSON.parse(line),
    next = waiting.shift()
  if (next) next(value)
  else queue.push(value)
})
const readFixture = () =>
  queue.length ? Promise.resolve(queue.shift()) : new Promise((done) => waiting.push(done))
const commandFixture = async (command) => {
  fixture.stdin.write(command + '\n')
  return readFixture()
}
const source = await readFixture()
const panel = await attach('/')
const overlay = await attach('/overlay.html')
await until('panel ready', () =>
  panel.eval('!!document.querySelector(\'[data-testid="toggle-frame"]\')')
)
const guest = {
  id: 'fullscreen-trial',
  name: 'Fullscreen guest',
  color: '#6cb6d9',
  x: 0.5,
  y: 0.5,
  clickKey: null
}
const allowed = {
  async pick() {
    return panel.invoke('select_window')
  },
  async start() {
    return panel.invoke('fullscreen_start')
  },
  async stop() {
    return panel.invoke('fullscreen_stop')
  },
  async guests() {
    await panel.invoke('set_peer_sharing', { session: 77 })
    await panel.invoke('set_show_frame', { show: false })
    await panel.invoke('show_peer_pointers', { session: 77, pointers: [guest] })
    return true
  },
  async edges() {
    await panel.invoke('show_peer_pointers', {
      session: 77,
      pointers: [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1]
      ].map(([x, y], i) => ({ ...guest, id: 'edge-' + i, name: 'Edge ' + i, x, y }))
    })
    return true
  },
  async state() {
    return {
      native: await commandFixture('status'),
      status: await panel.invoke('fullscreen_status'),
      overlay: await overlay.eval(
        `({x:screenX*devicePixelRatio,y:screenY*devicePixelRatio,width:innerWidth*devicePixelRatio,height:innerHeight*devicePixelRatio,guests:[...document.querySelectorAll('.point')].map(p=>({name:p.textContent,x:p.getBoundingClientRect().x,y:p.getBoundingClientRect().y})),frame:!!document.querySelector('.frame')})`
      )
    }
  },
  async minimized() {
    return commandFixture('minimize')
  },
  async restored() {
    return commandFixture('restore')
  },
  async resized() {
    return commandFixture('resize')
  },
  async focus() {
    return commandFixture('focus')
  },
  async crash() {
    const current = await commandFixture('status')
    if (!current.helperPid || (await panel.invoke('fullscreen_status')).state !== 'scaling')
      throw Error('No owned helper is scaling')
    process.kill(current.helperPid)
    return current.helperPid
  },
  async parentExit() {
    child.kill()
    return true
  },
  async quit() {
    fixture.stdin.end('close\n')
    child.kill()
    connections.forEach((c) => c.close())
    server.close()
    return true
  }
}
const server = httpServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1')
    const op = url.pathname.slice(1)
    if (req.method !== 'POST' || !Object.hasOwn(allowed, op)) throw Error('Unsupported local check')
    const value = await Promise.race([
      allowed[op](),
      sleep(12000).then(() => {
        throw Error('Check timed out')
      })
    ])
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(value))
  } catch (error) {
    res.statusCode = 500
    res.end(JSON.stringify({ error: String(error) }))
  }
})
server.listen(0, '127.0.0.1', async () => {
  await writeFile(
    'out/fullscreen-tools/desktop-session.json',
    JSON.stringify({ port: server.address().port, source, appPid: child.pid, profile })
  )
  console.log('READY', server.address().port, source)
})
process.on('SIGINT', () => {
  fixture.kill()
  child.kill()
  server.close()
})
