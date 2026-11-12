// SPDX-License-Identifier: GPL-3.0-or-later
// Test ownership cleanup without entering fullscreen or injecting input.
import assert from 'node:assert/strict'
import { fork, spawn } from 'node:child_process'
import { once } from 'node:events'
import { createInterface } from 'node:readline'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))
const helper = () =>
  spawn(resolve('resources/fullscreen/ghostlink-fullscreen-host.exe'), [], {
    cwd: resolve('out/fullscreen-native-check'),
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'ignore']
  })
if (process.argv.includes('--owner')) {
  const child = helper()
  createInterface({ input: child.stdout }).once('line', (line) => {
    const ready = JSON.parse(line)
    process.send({ pid: child.pid, ready })
  })
  setInterval(() => {}, 1000)
} else {
  const owner = fork(fileURLToPath(import.meta.url), ['--owner'], {
    windowsHide: true,
    stdio: ['ignore', 'ignore', 'inherit', 'ipc']
  })
  let childPid
  try {
    const [{ pid, ready }] = await Promise.race([
      once(owner, 'message'),
      sleep(5000).then(() => {
        throw Error('Owner startup timed out')
      })
    ])
    childPid = pid
    assert.equal(ready.state, 'ready')
    owner.kill()
    const deadline = Date.now() + 8000
    let alive = true
    while (Date.now() < deadline) {
      try {
        process.kill(pid, 0)
      } catch {
        alive = false
        break
      }
      await sleep(100)
    }
    assert.equal(alive, false, 'Helper must exit after abrupt owner death')
    const next = helper()
    const [line] = await once(createInterface({ input: next.stdout }), 'line')
    assert.equal(
      JSON.parse(line).state,
      'ready',
      'Exit hotkey must be released for the next helper'
    )
    const exit = once(next, 'exit')
    next.stdin.end('quit\n')
    await Promise.race([
      exit,
      sleep(6000).then(() => {
        next.kill()
        throw Error('Helper quit timed out')
      })
    ])
    console.log(
      'PASS abrupt owner death and inherited-pipe closure exit the idle helper and release its hotkey.'
    )
  } finally {
    if (owner.exitCode === null) owner.kill()
    if (childPid) {
      try {
        process.kill(childPid)
      } catch {
        /* The owned helper has already exited. */
      }
    }
  }
}
