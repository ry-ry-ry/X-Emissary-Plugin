# Builds the Chrome Web Store upload zip.
#
#   powershell -ExecutionPolicy Bypass -File scripts\package.ps1
#
# Only the files the extension actually loads are included — docs, git metadata and
# this script itself stay out of the package.

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$manifestPath = Join-Path $root "manifest.json"

if (-not (Test-Path $manifestPath)) {
    throw "manifest.json not found at $manifestPath"
}

$manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
$version = $manifest.version
$name = "x-emissary-$version.zip"

$distDir = Join-Path $root "dist"
if (-not (Test-Path $distDir)) {
    New-Item -ItemType Directory -Path $distDir | Out-Null
}

$outFile = Join-Path $distDir $name
if (Test-Path $outFile) {
    Remove-Item $outFile -Force
}

# manifest.json must sit at the zip root for Chrome to accept the upload.
$include = @(
    (Join-Path $root "manifest.json"),
    (Join-Path $root "background"),
    (Join-Path $root "content"),
    (Join-Path $root "lib"),
    (Join-Path $root "options"),
    (Join-Path $root "icons")
)

foreach ($path in $include) {
    if (-not (Test-Path $path)) {
        throw "expected to package '$path' but it does not exist"
    }
}

Compress-Archive -Path $include -DestinationPath $outFile -CompressionLevel Optimal

$sizeKb = [math]::Round((Get-Item $outFile).Length / 1KB, 1)
Write-Output "Packaged v$version -> $outFile ($sizeKb KB)"
Write-Output "Upload at: https://chrome.google.com/webstore/devconsole"
