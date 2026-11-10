param(
  [Parameter(Mandatory)][string]$Repository,
  [Parameter(Mandatory)][string]$Tag
)

$ErrorActionPreference = 'Stop'
$config = Get-Content 'src-tauri/tauri.conf.json' -Raw | ConvertFrom-Json
$version = $config.version
if ($Tag -cne "v$version") { throw "Tag $Tag does not match Tauri version $version" }
if (!$env:TAURI_UPDATER_PUBLIC_KEY -or !$env:TAURI_SIGNING_PRIVATE_KEY) {
  throw 'Set TAURI_UPDATER_PUBLIC_KEY and TAURI_SIGNING_PRIVATE_KEY before building release assets.'
}

$releaseUrl = "https://github.com/$Repository/releases"
$releaseDir = New-Item -ItemType Directory -Path 'dist/release' -Force
$overridePath = Join-Path $releaseDir.FullName 'tauri.release.json'
$override = @{
  bundle = @{ createUpdaterArtifacts = $true }
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
$bundle = 'src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis'
$installer = Join-Path $bundle $name
if ($env:TAURI_WINDOWS_SIGN_COMMAND) {
  foreach ($file in @($installer, "$bundle/../../ghostlink-tauri-prototype.exe")) {
    $signature = Get-AuthenticodeSignature -FilePath $file
    if ($signature.Status -ne 'Valid' -or !$signature.TimeStamperCertificate) {
      throw "Authenticode signature or timestamp is invalid for $file."
    }
  }
}
Copy-Item -LiteralPath $installer, "$installer.sig" -Destination $releaseDir.FullName -Force
@{
  version = $version
  platforms = @{
    'windows-x86_64' = @{
      url = "$releaseUrl/download/$Tag/$name"
      signature = (Get-Content -LiteralPath "$installer.sig" -Raw).Trim()
    }
  }
} | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $releaseDir.FullName 'latest.json') -Encoding utf8
