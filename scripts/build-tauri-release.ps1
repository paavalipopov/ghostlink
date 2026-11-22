param(
  [Parameter(Mandatory)][string]$Repository,
  [Parameter(Mandatory)][string]$Tag
)

$ErrorActionPreference = 'Stop'
$config = Get-Content 'src-tauri/tauri.conf.json' -Raw | ConvertFrom-Json
$version = $config.version
if ($Tag -cne "v$version") { throw "Tag $Tag does not match Tauri version $version" }
if (!$env:TAURI_UPDATER_PUBLIC_KEY) {
  throw 'Set the public updater verification key before building release assets.'
}
if ($env:TAURI_SIGNING_PRIVATE_KEY -or $env:TAURI_SIGNING_PRIVATE_KEY_PATH -or $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD) {
  throw 'Run the build in an environment without updater signing credentials.'
}

$releaseUrl = "https://github.com/$Repository/releases"
$releaseDir = New-Item -ItemType Directory -Path 'dist/unsigned-release' -Force
$overridePath = Join-Path $releaseDir.FullName 'tauri.release.json'
$override = @{
  bundle = @{ createUpdaterArtifacts = $false }
  plugins = @{ updater = @{
    pubkey = $env:TAURI_UPDATER_PUBLIC_KEY.Trim()
    endpoints = @("$releaseUrl/latest/download/latest.json")
  } }
}
if ($env:TAURI_WINDOWS_SIGN_COMMAND) {
  $override.bundle.windows = @{ signCommand = $env:TAURI_WINDOWS_SIGN_COMMAND }
}
$override | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $overridePath -Encoding utf8

npm.cmd run prototype:build -- --config $overridePath -- --locked
if ($LASTEXITCODE -ne 0) { throw 'Tauri release build failed.' }

$name = "Ghostlink_${version}_x64-setup.exe"
$targetDir = if ($env:CARGO_TARGET_DIR) { $env:CARGO_TARGET_DIR } else { 'src-tauri/target' }
$bundle = Join-Path $targetDir 'x86_64-pc-windows-msvc/release/bundle/nsis'
$installer = Join-Path $bundle $name
if ($env:TAURI_WINDOWS_SIGN_COMMAND) {
  foreach ($file in @($installer, "$bundle/../../ghostlink-tauri-prototype.exe")) {
    $signature = Get-AuthenticodeSignature -FilePath $file
    if ($signature.Status -ne 'Valid' -or !$signature.TimeStamperCertificate) {
      throw "Authenticode signature or timestamp is invalid for $file."
    }
  }
}
Copy-Item -LiteralPath $installer -Destination $releaseDir.FullName -Force

$source = Join-Path $releaseDir.FullName "Ghostlink_${version}_source.zip"
if ($env:CI -eq 'true') {
  git diff --exit-code
  if ($LASTEXITCODE -ne 0) { throw 'Build modified tracked source files.' }
}
python scripts/package-fullscreen-source.py --output $source --release-config $overridePath
if ($LASTEXITCODE -ne 0) { throw 'Matching source packaging failed.' }
