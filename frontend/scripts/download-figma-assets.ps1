$ErrorActionPreference = 'Stop'
$workspaceRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$manifestPath = Join-Path $workspaceRoot 'docs\figma-reference\download-manifest.json'
$assetDirectory = Join-Path $workspaceRoot 'frontend\public\assets\figma'
New-Item -ItemType Directory -Force -Path $assetDirectory | Out-Null
$assets = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
foreach ($asset in $assets) {
  $destination = Join-Path $assetDirectory $asset.file
  if ((Test-Path -LiteralPath $destination) -and (Get-Item -LiteralPath $destination).Length -gt 0) { continue }
  & curl.exe -L --fail --silent --show-error --retry 2 -o $destination $asset.url
  if ($LASTEXITCODE -ne 0) { throw "Asset download failed: $($asset.file)" }
  if ((Get-Item -LiteralPath $destination).Length -eq 0) { throw "Empty asset: $($asset.file)" }
}
Write-Output ('Verified {0} Figma assets.' -f $assets.Count)
