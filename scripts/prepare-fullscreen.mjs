import { spawnSync } from 'node:child_process'
if (process.platform === 'win32') {
  const result = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'scripts/build-fullscreen-host.ps1'],
    { stdio: 'inherit', windowsHide: true }
  )
  if (result.error) throw result.error
  if (result.status) process.exit(result.status)
}
