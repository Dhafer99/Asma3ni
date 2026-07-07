$ErrorActionPreference = "Stop"

$modelUrl = "https://huggingface.co/linagora/linto-asr-ar-tn-0.1/resolve/main/android-model.zip"
$modelsDir = Join-Path $PSScriptRoot "models"
$zipPath = Join-Path $modelsDir "android-model.zip"
$extractDir = Join-Path $modelsDir "android-model"

New-Item -ItemType Directory -Force -Path $modelsDir | Out-Null

Write-Host "Downloading Android Vosk model..."
Invoke-WebRequest -Uri $modelUrl -OutFile $zipPath

if (Test-Path $extractDir) {
  Remove-Item -Recurse -Force $extractDir
}

Write-Host "Extracting model..."
Expand-Archive -Path $zipPath -DestinationPath $extractDir
Write-Host "Model ready at $extractDir"
