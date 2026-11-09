import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { createServer } from 'node:net'

const reservation = createServer()
await new Promise((resolvePort, rejectPort) => {
  reservation.once('error', rejectPort)
  reservation.listen(0, '127.0.0.1', resolvePort)
})
const port = reservation.address().port
await new Promise((done) => reservation.close(done))
const previewExe = process.argv[2]
const child = spawn(
  resolve(previewExe || 'node_modules/electron/dist/electron.exe'),
  [
    ...(!previewExe ? [resolve('out/main/index.js')] : []),
    `--remote-debugging-port=${port}`,
    '--remote-debugging-address=127.0.0.1',
    `--user-data-dir=${resolve(`out/link-check/profile-${process.pid}`)}`
  ],
  { windowsHide: true, stdio: 'ignore', env: { ...process.env, GHOSTLINK_DEBUG: '0' } }
)
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))
async function waitFor(read, timeout = 30_000) {
  const start = Date.now()
  let last
  while (Date.now() - start < timeout) {
    try {
      const result = await read()
      if (result) return result
    } catch (e) {
      last = e
    }
    await sleep(200)
  }
  throw last || new Error('Timed out')
}
async function cdp(target, method, params) {
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true })
    ws.addEventListener('error', rej, { once: true })
  })
  const response = new Promise((res, rej) => {
    const timer = setTimeout(() => {
      ws.close()
      rej(new Error(`CDP timeout: ${method}`))
    }, 15_000)
    ws.addEventListener('message', (event) => {
      const value = JSON.parse(event.data)
      if (value.id === 1) {
        clearTimeout(timer)
        res(value)
      }
    })
  })
  ws.send(JSON.stringify({ id: 1, method, params }))
  const result = await response
  ws.close()
  if (result.error) throw new Error(JSON.stringify(result.error))
  return result.result
}
async function evaluate(target, expression) {
  const result = await cdp(target, 'Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true
  })
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
  return result.result.value
}
async function page(name) {
  return waitFor(async () => {
    const r = await fetch(`http://127.0.0.1:${port}/json/list`)
    return (await r.json()).find((p) => p.type === 'page' && p.url.includes(name))
  })
}
let main
try {
  await mkdir(resolve('out/link-check'), { recursive: true })
  main = await page('index.html')
  await waitFor(() => evaluate(main, `!!document.querySelector('[data-testid="open-pad"]')`))
  assert.equal((await evaluate(main, 'window.api.hookStatus()')).live, true)
  assert.equal(
    await evaluate(main, `document.querySelector('[data-testid="connect"]').dataset.mode`),
    'idle'
  )
  const area = { x: 120, y: 100, width: 480, height: 320 }
  assert.equal(await evaluate(main, `window.api.restorePlayArea(${JSON.stringify(area)})`), true)
  assert.equal(
    await evaluate(main, `document.querySelector('[data-testid="open-pad"]').disabled`),
    false
  )
  await evaluate(main, `document.querySelector('[data-testid="open-pad"]').click()`)
  const pad = await page('pad.html'),
    overlay = await page('overlay.html')
  await waitFor(() =>
    evaluate(pad, `document.querySelector('[data-testid="pad-surface"]') !== null`)
  )
  console.log('Test opened with no username, secret or Connect click.')
  const layout = await evaluate(
    pad,
    `(() => {
    const surface = document.querySelector('[data-testid="pad-surface"]').getBoundingClientRect()
    return { width: innerWidth, height: innerHeight, surfaceHeight: surface.height,
      bottom: surface.bottom, overflow: document.documentElement.scrollWidth > innerWidth }
  })()`
  )
  assert.ok(layout.width <= 360 && layout.height <= 350)
  assert.ok(layout.surfaceHeight > 80 && layout.bottom <= layout.height && !layout.overflow)
  console.log('Compact trackpad fits without overflow:', JSON.stringify(layout))
  console.log(
    'Selected area:',
    await evaluate(pad, `document.querySelector('[data-testid="pad-area"]').textContent`)
  )
  await waitFor(
    () =>
      evaluate(
        pad,
        `document.querySelector('[data-testid="pad-status"]').dataset.phase === 'linked'`
      ),
    50_000
  )
  console.log('Real private WebRTC test peer connected.')
  assert.equal(
    await evaluate(pad, `document.querySelector('[data-testid="pad-relays"]').dataset.state`),
    'live'
  )
  assert.equal(
    await evaluate(main, `document.querySelector('[data-testid="connect"]').dataset.mode`),
    'idle'
  )
  await evaluate(
    pad,
    `(() => {
    const node=document.querySelector('[data-testid="pad-surface"]'),r=node.getBoundingClientRect()
    node.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,clientX:r.x+r.width*.25,clientY:r.y+r.height*.4,pointerId:1,pointerType:'mouse'}))
  })()`
  )
  const ghost = await waitFor(() =>
    evaluate(
      overlay,
      `(() => {const g=document.querySelector('[data-testid="overlay-ghost"][data-name="Test user"]');return g?{x:Number(g.dataset.x),y:Number(g.dataset.y),left:parseFloat(g.style.left),top:parseFloat(g.style.top)}:null})()`
    )
  )
  assert.ok(Math.abs(ghost.x - 0.25) < 0.01 && Math.abs(ghost.y - 0.4) < 0.01)
  const frame = await evaluate(
    overlay,
    `(() => {const r=document.querySelector('.frame');return {x:parseFloat(r.style.left),y:parseFloat(r.style.top),w:parseFloat(r.style.width),h:parseFloat(r.style.height)}})()`
  )
  assert.ok(Math.abs(ghost.left - (frame.x + frame.w * 0.25)) < 2)
  assert.ok(Math.abs(ghost.top - (frame.y + frame.h * 0.4)) < 2)
  console.log('Small test surface mapped correctly into selected area:', JSON.stringify(ghost))
  await evaluate(
    pad,
    `(() => {const n=document.querySelector('[data-testid="pad-surface"]'),r=n.getBoundingClientRect();n.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,clientX:r.x+r.width*.25,clientY:r.y+r.height*.4,pointerId:1,pointerType:'mouse'}))})()`
  )
  await waitFor(() =>
    evaluate(
      overlay,
      `document.querySelector('[data-testid="overlay-ghost"][data-name="Test user"]')?.dataset.flash === '1'`
    )
  )
  console.log('Click traveled over the peer connection and blinked the overlay pointer.')
  assert.equal(
    await evaluate(
      pad,
      `document.querySelectorAll('[data-testid="pad-cursor"], [data-testid="stage-ghost"]').length`
    ),
    0
  )
  const shot = await cdp(pad, 'Page.captureScreenshot', { format: 'png' })
  await writeFile(resolve('out/link-check/test-peer.png'), Buffer.from(shot.data, 'base64'))
  await evaluate(
    pad,
    `(() => {const n=document.querySelector('[data-testid="pad-surface"]');n.dispatchEvent(new PointerEvent('pointerout',{bubbles:true,relatedTarget:document.body,pointerType:'mouse'}))})()`
  )
  await waitFor(() =>
    evaluate(
      overlay,
      `!document.querySelector('[data-testid="overlay-ghost"][data-name="Test user"]')`
    )
  )
  await evaluate(pad, 'window.close()')
  await sleep(600)
  assert.deepEqual(await evaluate(main, 'window.api.getPlayArea()'), area)
  assert.equal(
    await evaluate(main, `document.querySelector('[data-testid="connect"]').dataset.mode`),
    'idle'
  )
  console.log('Closing the test preserves the selected area and normal connection state.')
} catch (error) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
    for (const p of list.filter((p) => p.url.includes('pad.html'))) {
      console.error(
        'Diagnostic:',
        await evaluate(
          p,
          `({phase:document.querySelector('[data-testid="pad-status"]')?.dataset.phase,relays:document.querySelector('[data-testid="pad-relays"]')?.outerHTML,peer:document.querySelector('[data-testid="pad-peer"]')?.outerHTML})`
        )
      )
    }
  } catch {
    // The application may already have exited after a failed check.
  }
  console.error(error)
  process.exitCode = 1
} finally {
  if (main)
    try {
      await evaluate(main, 'window.close()')
    } catch {
      // Fall back to stopping only the process tree launched by this test.
    }
  await sleep(1000)
  if (child.exitCode === null) {
    const kill = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore'
    })
    await new Promise((done) => kill.once('exit', done))
  }
}
