import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { build } from 'vite'
import { WebSocketServer } from 'ws'

const browser =
  process.env.GHOSTLINK_BROWSER ||
  [
    join(process.env['ProgramFiles(x86)'] || '', 'Microsoft/Edge/Application/msedge.exe'),
    join(process.env.ProgramFiles || '', 'Google/Chrome/Application/chrome.exe'),
    '/usr/bin/google-chrome',
    '/usr/bin/chromium'
  ].find(existsSync)
if (!browser) throw new Error('Set GHOSTLINK_BROWSER to an installed Chrome or Edge executable.')
const temp = await mkdtemp(join(tmpdir(), 'ghostlink-room-'))
const site = join(temp, 'site'),
  token = randomUUID()
let done, fail
const result = new Promise((res, rej) => {
  done = res
  fail = rej
})
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost')
  if (
    req.method === 'POST' &&
    url.pathname === '/result' &&
    url.searchParams.get('run') === token
  ) {
    let status = ''
    for await (const part of req) status += part.toString()
    res.end()
    if (status === 'ok') done()
    else fail(new Error(status))
    return
  }
  if (!/^\/(room\.html|assets\/[\w.-]+\.js)$/.test(url.pathname)) {
    res.writeHead(404).end()
    return
  }
  try {
    res.setHeader('Content-Type', url.pathname.endsWith('.js') ? 'text/javascript' : 'text/html')
    res.end(await readFile(join(site, url.pathname)))
  } catch {
    res.writeHead(404).end()
  }
})
const relay = new WebSocketServer({ server, path: '/relay', maxPayload: 128 * 1024 })
const subscriptions = new Map()
relay.on('connection', (socket) => {
  const filters = new Map()
  subscriptions.set(socket, filters)
  socket.on('close', () => subscriptions.delete(socket))
  socket.on('message', (bytes) => {
    const [type, item, filter] = JSON.parse(bytes.toString())
    if (type === 'REQ') {
      filters.set(item, filter['#x'])
      socket.send(JSON.stringify(['EOSE', item]))
    } else if (type === 'CLOSE') filters.delete(item)
    else if (type === 'EVENT') {
      const topic = item.tags.find(([key]) => key === 'x')?.[1]
      for (const [client, subs] of subscriptions) {
        for (const [id, topics] of subs) {
          if (topics.includes(topic)) client.send(JSON.stringify(['EVENT', id, item]))
        }
      }
      socket.send(JSON.stringify(['OK', item.id, true, '']))
    }
  })
})
let child, timeout
try {
  await build({
    configFile: false,
    root: resolve('tests/browser'),
    logLevel: 'warn',
    build: {
      outDir: site,
      emptyOutDir: true,
      rollupOptions: { input: resolve('tests/browser/room.html') }
    }
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  child = spawn(
    browser,
    [
      '--headless=new',
      '--remote-debugging-port=0',
      '--remote-debugging-address=127.0.0.1',
      '--disable-background-networking',
      '--no-first-run',
      '--disable-background-timer-throttling',
      '--disable-default-apps',
      '--no-default-browser-check',
      '--user-data-dir=' + join(temp, 'profile'),
      'http://127.0.0.1:' + server.address().port + '/room.html?run=' + token
    ],
    { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] }
  )
  let diagnostic = ''
  child.stderr.on('data', (chunk) => {
    diagnostic = (diagnostic + chunk.toString()).slice(-1800)
  })
  child.once('error', fail)
  child.once('exit', (code) => {
    if (code) fail(new Error('Browser exited (' + code + '): ' + diagnostic))
  })
  timeout = setTimeout(
    () => fail(new Error('Browser connection test timed out: ' + diagnostic)),
    90000
  )
  await result
  console.log(
    'Passed real WebRTC exchange, click expiry, secret replacement, wrong password, private test isolation and reconnect.'
  )
} finally {
  clearTimeout(timeout)
  // Edge on Windows can return from its launcher before the test browser exits.
  // Close the browser belonging to this fresh profile, including child processes.
  try {
    const [port, path] = (await readFile(join(temp, 'profile', 'DevToolsActivePort'), 'utf8'))
      .trim()
      .split(/\r?\n/)
    if (/^\d+$/.test(port) && /^\/devtools\/browser\/[\w-]+$/.test(path)) {
      const control = new WebSocket('ws://127.0.0.1:' + port + path)
      await new Promise((finish) => {
        const timer = setTimeout(() => {
          control.close()
          finish()
        }, 1500)
        const end = () => {
          clearTimeout(timer)
          finish()
        }
        control.addEventListener('open', () =>
          control.send(JSON.stringify({ id: 1, method: 'Browser.close' }))
        )
        control.addEventListener('close', end)
        control.addEventListener('error', end)
      })
    }
  } catch {
    /* A failed launch may have no debugging endpoint. */
  }
  child?.kill()
  for (const socket of relay.clients) socket.terminate()
  relay.close()
  server.closeAllConnections()
  server.close()
  await rm(temp, { recursive: true, force: true, maxRetries: 6, retryDelay: 250 }).catch(() => {})
}
