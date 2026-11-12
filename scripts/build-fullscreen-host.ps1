param([switch]$Restore)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $root
if ($env:OS -ne 'Windows_NT') { throw 'The native fullscreen host builds on Windows only.' }
$tools = Join-Path $root 'out/fullscreen-tools'
New-Item -ItemType Directory -Force $tools | Out-Null
$vs = 'C:/Program Files (x86)/Microsoft Visual Studio/18/BuildTools'
$msbuild = Join-Path $vs 'MSBuild/Current/Bin/MSBuild.exe'
if (!(Test-Path -LiteralPath $msbuild)) {
  $vswhere = 'C:/Program Files (x86)/Microsoft Visual Studio/Installer/vswhere.exe'
  $vs = & $vswhere -latest -prerelease -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
  $msbuild = Join-Path $vs 'MSBuild/Current/Bin/MSBuild.exe'
}
if (!(Test-Path -LiteralPath $msbuild)) { throw 'Install VS 2026 C++ build tools (v145) and Windows SDK 10.0.26100.0.' }
$conan = Join-Path $tools 'python/Scripts/conan.exe'
$nuget = Join-Path $tools 'nuget.exe'
if (!(Test-Path -LiteralPath $conan)) {
  python -m venv (Join-Path $tools 'python')
  if ($LASTEXITCODE) { throw 'Python venv setup failed.' }
  & (Join-Path $tools 'python/Scripts/python.exe') -m pip install conan==2.27.0
  if ($LASTEXITCODE) { throw 'Conan setup failed.' }
}
if (!(Test-Path -LiteralPath $nuget)) {
  Invoke-WebRequest 'https://dist.nuget.org/win-x86-commandline/v6.14.0/nuget.exe' -OutFile $nuget -UseBasicParsing
}
$magpie = Join-Path $root 'third_party/magpie'
if ($Restore -or !(Test-Path "$magpie/packages/Microsoft.Windows.CppWinRT.3.0.260818.1")) {
  & $nuget restore "$magpie/src/Magpie.Core/packages.config" -PackagesDirectory "$magpie/packages" -NonInteractive
  if ($LASTEXITCODE) { throw 'NuGet restore failed.' }
}
$env:CONAN_HOME = Join-Path $root 'out/conan'
$env:PATH = (Join-Path $tools 'python/Scripts') + ';' + $env:PATH
$deps = "$magpie/obj/x64/Release/_ConanDeps/Magpie"
if ($Restore -or !(Test-Path "$deps/conandeps.props")) {
  & $conan install "$magpie/src/Magpie/conanfile.txt" "-pr:h=$magpie/src/_ConanDeps/host-msvc.profile" "-pr:b=$magpie/src/_ConanDeps/build.profile" -s:h arch=x86_64 -s:h build_type=Release -s:b arch=x86_64 "-c:a=tools.microsoft.msbuild:installation_path=$vs" --lockfile=native/fullscreen-host/conan.lock --output-folder $deps --build=missing
  if ($LASTEXITCODE) { throw 'Conan restore failed.' }
}
& $msbuild native/fullscreen-host/fullscreen-host.vcxproj /m:4 /p:Configuration=Release /p:Platform=x64 "/p:SolutionDir=$magpie\" "/p:OutBaseDir=$root\out\fullscreen-host\" /p:DisableUserBuildOptions=true /verbosity:minimal
if ($LASTEXITCODE) { throw 'Native fullscreen build failed.' }
$stage = Join-Path $root 'resources/fullscreen'
New-Item -ItemType Directory -Force "$stage/effects","$stage/licenses" | Out-Null
Copy-Item -LiteralPath 'out/fullscreen-host/ghostlink-fullscreen-host.exe' -Destination $stage -Force
foreach ($effect in @('Bilinear.hlsl','Bicubic.hlsl','StubDefs.hlsli')) {
  Copy-Item -LiteralPath "$magpie/src/Effects/$effect" -Destination "$stage/effects" -Force
}
Copy-Item -LiteralPath "$magpie/LICENSE" -Destination "$stage/licenses/Magpie-GPL-3.0.txt" -Force
Copy-Item -LiteralPath 'native/fullscreen-host/THIRD-PARTY-NOTICES.md','third_party/magpie/GHOSTLINK-PROVENANCE.md' -Destination "$stage/licenses" -Force
Get-ChildItem "$magpie/packages" -Directory | ForEach-Object {
  Copy-Item -LiteralPath (Join-Path $_.FullName 'LICENSE') -Destination "$stage/licenses/$($_.Name)-LICENSE.txt" -Force
}
# Conan packages contain upstream notices, including third-party portions of imgui.
Get-ChildItem "$root/out/conan/p" -Directory | ForEach-Object {
  $licenseDir = Join-Path $_.FullName 'p/licenses'
  if (Test-Path $licenseDir) {
    $dest = Join-Path "$stage/licenses" $_.Name
    New-Item -ItemType Directory -Force $dest | Out-Null
    Copy-Item -Path "$licenseDir/*" -Destination $dest -Recurse -Force
  }
}
Get-ChildItem "$root/out/conan/p/b" -Directory -ErrorAction SilentlyContinue | ForEach-Object {
  $licenseDir = Join-Path $_.FullName 'p/licenses'
  if (Test-Path $licenseDir) {
    $dest = Join-Path "$stage/licenses" $_.Name
    New-Item -ItemType Directory -Force $dest | Out-Null
    Copy-Item -Path "$licenseDir/*" -Destination $dest -Recurse -Force
  }
}
Write-Host "Bundled fullscreen host staged at $stage"
