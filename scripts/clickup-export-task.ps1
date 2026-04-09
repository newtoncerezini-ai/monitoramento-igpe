$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot

& "C:\Program Files\nodejs\npm.cmd" run clickup:export
