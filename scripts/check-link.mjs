import { spawn } from 'node:child_process'
import { createWsRelayServer } from '@trystero-p2p/ws-relay/server'

const relayPort = 9077
const code = `check-${Date.now()}`
const relayUrl = `ws://127.0.0.1:${relayPort}`

const relay = createWsRelayServer({ port: relayPort })
await relay.ready
console.log(`relay ready on ${relayPort}`)

const child = spawn('npx', ['electron-vite', 'dev', '--', '--no-sandbox'], {
  env: { ...process.env, GHOSTLINK_DEBUG: '1' },
  stdio: 'inherit',
  detached: true
})

let stopped = false
async function stop(code = 0) {
  if (stopped) return
  stopped = true
  try {
    process.kill(-child.pid, 'SIGTERM')
  } catch {
    child.kill('SIGTERM')
  }
  await relay.close()
  process.exit(code)
}

process.on('SIGINT', () => void stop(1))
child.on('exit', (status) => {
  if (!stopped) {
    console.error(`dev server exited early (${status})`)
    void stop(1)
  }
})

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function targets() {
  const response = await fetch('http://127.0.0.1:9333/json')
  if (!response.ok) throw new Error(`debug port ${response.status}`)
  return response.json()
}

async function waitFor(label, read, timeoutMs) {
  const start = Date.now()
  let last
  while (Date.now() - start < timeoutMs) {
    try {
      const value = await read()
      if (value) return value
      last = value
    } catch (error) {
      last = error instanceof Error ? error.message : String(error)
    }
    await sleep(400)
  }
  throw new Error(`timed out waiting for ${label}: ${last}`)
}

async function evaluate(wsUrl, expression) {
  const ws = new WebSocket(wsUrl)
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true })
    ws.addEventListener('error', reject, { once: true })
  })
  let id = 0
  const pending = new Map()
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    const done = pending.get(message.id)
    if (done) {
      pending.delete(message.id)
      done(message)
    }
  })
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const msgId = ++id
      pending.set(msgId, resolve)
      ws.send(JSON.stringify({ id: msgId, method, params }))
    })
  await send('Runtime.enable')
  const response = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true
  })
  ws.close()
  if (response.result?.exceptionDetails) {
    throw new Error(JSON.stringify(response.result.exceptionDetails))
  }
  return response.result?.result?.value
}

let failed = false
try {
  const pages = await waitFor(
    'Ghostlink window',
    async () => {
      const list = await targets()
      return list.find(
        (target) =>
          target.type === 'page' &&
          !target.url.includes('pad.html') &&
          !target.url.includes('overlay.html') &&
          !target.url.startsWith('devtools://')
      )
    },
    45000
  )

  console.log(`main page ${pages.url}`)

  await waitFor(
    'name field',
    async () => {
      const value = await evaluate(
        pages.webSocketDebuggerUrl,
        `document.querySelector('[data-testid=name-input]') ? 'ready' : ''`
      )
      return value === 'ready' ? value : ''
    },
    20000
  )

  const armed = await evaluate(
    pages.webSocketDebuggerUrl,
    `(() => {
    const setInput = (selector, value) => {
      const el = document.querySelector(selector)
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      setter.call(el, value)
      el.dispatchEvent(new Event('input', { bubbles: true }))
    }
    setInput('[data-testid=name-input]', 'Ada')
    setInput('[data-testid=code-input]', ${JSON.stringify(code)})
    setInput('[data-testid=relay-url]', ${JSON.stringify(relayUrl)})
    return document.querySelector('[data-testid=code-input]').value
  })()`
  )
  console.log(`typed ${armed}`)

  await sleep(300)

  const clicked = await evaluate(
    pages.webSocketDebuggerUrl,
    `(() => {
    const button = document.querySelector('[data-testid=connect]')
    if (button.disabled) return 'disabled'
    button.click()
    return 'clicked'
  })()`
  )
  if (clicked !== 'clicked') throw new Error(`connect button was ${clicked}`)
  console.log('connect clicked')

  await sleep(300)
  const opened = await evaluate(
    pages.webSocketDebuggerUrl,
    `(() => {
    const button = document.querySelector('[data-testid=open-pad]')
    if (!button || button.disabled) return 'disabled'
    button.click()
    return 'opened'
  })()`
  )
  if (opened !== 'opened') throw new Error(`test seat button was ${opened}`)
  console.log('test seat opened')

  const pad = await waitFor(
    'test seat',
    async () => {
      const list = await targets()
      return list.find((target) => target.type === 'page' && target.url.includes('pad.html'))
    },
    20000
  )
  console.log(`pad page ${pad.url}`)

  const linked = await waitFor(
    'direct link',
    async () => {
      const phase = await evaluate(
        pad.webSocketDebuggerUrl,
        `document.querySelector('[data-testid=pad-status]')?.dataset.phase ?? ''`
      )
      return phase === 'linked' ? phase : ''
    },
    30000
  )
  console.log(`pad phase ${linked}`)

  const moved = await evaluate(
    pad.webSocketDebuggerUrl,
    `(() => {
    const el = document.querySelector('[data-testid=pad-surface]')
    const rect = el.getBoundingClientRect()
    const x = rect.left + rect.width * 0.25
    const y = rect.top + rect.height * 0.4
    el.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true,
      clientX: x,
      clientY: y,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true
    }))
    return 'moved'
  })()`
  )
  console.log(moved)

  const ghost = await waitFor(
    'ghost on the main stage',
    async () => {
      const value = await evaluate(
        pages.webSocketDebuggerUrl,
        `(() => {
      const ghost = document.querySelector('[data-testid=stage-ghost]')
      if (!ghost) return ''
      return ghost.dataset.name + ' ' + ghost.dataset.x + ' ' + ghost.dataset.y
    })()`
      )
      return value && value.startsWith('Test seat') ? value : ''
    },
    10000
  )

  console.log(`ghost ${ghost}`)
  const parts = ghost.trim().split(' ')
  const ny = Number(parts.at(-1))
  const nx = Number(parts.at(-2))
  if (Math.abs(nx - 0.25) > 0.02 || Math.abs(ny - 0.4) > 0.02) {
    throw new Error(`ghost landed at ${nx}, ${ny}`)
  }

  await evaluate(
    pad.webSocketDebuggerUrl,
    `(() => {
    const el = document.querySelector('[data-testid=pad-surface]')
    const rect = el.getBoundingClientRect()
    el.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true,
      button: 0,
      buttons: 1,
      clientX: rect.left + rect.width * 0.25,
      clientY: rect.top + rect.height * 0.4,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true
    }))
    return 'clicked'
  })()`
  )

  const ping = await waitFor(
    'click ping',
    async () => {
      const count = await evaluate(
        pages.webSocketDebuggerUrl,
        `document.querySelectorAll('[data-testid=stage-ping]').length`
      )
      return count > 0 ? String(count) : ''
    },
    5000
  )
  console.log(`pings ${ping}`)

  console.log('link check passed')
} catch (error) {
  failed = true
  console.error(error)
} finally {
  await stop(failed ? 1 : 0)
}
