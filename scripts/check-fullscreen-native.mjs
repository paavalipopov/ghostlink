// Real Magpie.Core + D3D11 + Windows.Graphics.Capture, without moving the mouse.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { resolve } from 'node:path'
import { mkdir, copyFile, writeFile, access } from 'node:fs/promises'

const sleep = (ms) => new Promise((done) => setTimeout(done, ms))
function channel(exe, cwd) {
  const child = spawn(resolve(exe), [], {
    cwd,
    stdio: ['pipe', 'pipe', 'inherit'],
    windowsHide: true
  })
  const pending = [],
    messages = []
  const lines = createInterface({ input: child.stdout })
  lines.on('line', (line) => {
    const msg = JSON.parse(line)
    const next = pending.shift()
    if (next) next(msg)
    else messages.push(msg)
  })
  return {
    child,
    read() {
      if (messages.length) return Promise.resolve(messages.shift())
      return new Promise((done, fail) => {
        const timer = setTimeout(() => fail(Error('Native response timeout: ' + exe)), 10000)
        pending.push((msg) => {
          clearTimeout(timer)
          done(msg)
        })
      })
    },
    async send(command) {
      child.stdin.write(command + '\n')
      return this.read()
    },
    async exit(command = 'quit') {
      if (child.exitCode !== null) return
      child.stdin.end(command + '\n')
      const deadline = Date.now() + 6000
      while (child.exitCode === null && Date.now() < deadline) await sleep(30)
      assert.notEqual(child.exitCode, null, 'Process must exit cleanly')
    }
  }
}
async function until(label, read, test, timeout = 15000) {
  const deadline = Date.now() + timeout
  let last
  while (Date.now() < deadline) {
    last = await read()
    if (test(last)) return last
    await sleep(100)
  }
  throw Error(label + ': ' + JSON.stringify(last))
}
const cwd = resolve('out/fullscreen-native-check')
await mkdir(resolve(cwd, 'effects'), { recursive: true })
for (const file of ['Bilinear.hlsl', 'Bicubic.hlsl', 'StubDefs.hlsli'])
  await copyFile(resolve('resources/fullscreen/effects', file), resolve(cwd, 'effects', file))
const fixture = channel('out/fullscreen-host/fullscreen-fixture.exe')
let host
try {
  const target = await fixture.read()
  host = channel('resources/fullscreen/ghostlink-fullscreen-host.exe', cwd)
  assert.equal((await host.read()).state, 'ready')
  for (const command of [
    'start 0 0 0',
    'start -1 0 0',
    'start 123 0 0',
    'start 0 0 0 extra',
    'garbage',
    `start ${target.hwnd} ${target.pid + 1} ${target.thread}`
  ]) {
    assert.equal((await host.send(command)).state, 'rejected')
  }
  assert.equal((await host.send('status')).state, 'idle')
  const other = channel('resources/fullscreen/ghostlink-fullscreen-host.exe', cwd)
  assert.equal((await other.read()).error, -2, 'Conflicting exit hotkey must fail closed')
  await other.exit()
  console.log('PASS invalid targets, malformed requests, PID identity and exit-hotkey conflict.')
  if (process.env.GHOSTLINK_FOREGROUND_CHECK) {
    await writeFile('out/fullscreen-tools/fixture-ready.json', JSON.stringify(target))
    await until(
      'fixture focus coordination',
      async () => {
        try {
          await access('out/fullscreen-tools/foreground-ready')
          return true
        } catch {
          return false
        }
      },
      Boolean,
      120000
    )
  }
  const startTime = Date.now()
  assert.equal(
    (await host.send(`start ${target.hwnd} ${target.pid} ${target.thread}`)).state,
    'starting'
  )
  await until(
    'real scaling',
    () => host.send('status'),
    (s) => s.state === 'scaling'
  )
  const first = await fixture.send('status')
  assert.equal(first.helperPid, host.child.pid)
  assert.ok(first.display[2] > first.display[0] && first.input[2] > first.input[0])
  assert.equal(first.foreground, target.hwnd, 'Source keeps focus')
  console.log(
    'PASS real D3D capture/presentation, source and destination metadata. Start ms:',
    Date.now() - startTime
  )
  console.log('SCALING', JSON.stringify(first))
  const frameBefore = first.frames
  await sleep(3000)
  assert.ok((await fixture.send('status')).frames > frameBefore + 50)
  console.log('CHECK minimizing source')
  await fixture.send('minimize')
  console.log('CHECK minimized source responded')
  await until(
    'minimized pause',
    () => host.send('status'),
    (s) => s.state === 'waiting'
  )
  assert.equal((await fixture.send('status')).scalingHwnd, 0)
  console.log('CHECK restoring source')
  await fixture.send('restore')
  console.log('CHECK restored source responded')
  await until(
    'restored capture',
    () => host.send('status'),
    (s) => s.state === 'scaling'
  )
  console.log('CHECK resizing source')
  await fixture.send('resize')
  console.log('CHECK resized source responded')
  await until(
    'resized source mapping',
    () => fixture.send('status'),
    (s) => s.input[2] - s.input[0] > first.input[2] - first.input[0]
  )
  console.log('PASS minimize/restore/resize with real captured source.')
  await host.exit('stop')
  const stopped = await fixture.send('status')
  assert.equal(stopped.scalingHwnd, 0)
  assert.deepEqual(stopped.clip, target.clip)
  assert.equal(stopped.speed, target.speed)
  console.log('PASS stop exits helper and restores cursor clipping/speed.')
  host = channel('resources/fullscreen/ghostlink-fullscreen-host.exe', cwd)
  await host.read()
  await host.send(`start ${target.hwnd} ${target.pid} ${target.thread}`)
  await until(
    'second scaling',
    () => host.send('status'),
    (s) => s.state === 'scaling'
  )
  fixture.child.stdin.end('close\n')
  await until(
    'source close cleanup',
    async () => host.child.exitCode,
    (x) => x !== null
  )
  console.log('PASS target exit cleans up helper.')
} finally {
  if (host) await host.exit().catch(() => host.child.kill())
  await fixture.exit('close').catch(() => fixture.child.kill())
}
