param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$Session,

    [ValidateSet("whisper-large-v3", "whisper-large-v3-turbo")]
    [string]$Modelo = "whisper-large-v3",

    [ValidatePattern("^[a-z]{2}$")]
    [string]$Idioma = "pt",

    [ValidateRange(1, 8)]
    [double]$MinutosPorTrecho = 8,

    [string]$Glossario,

    [switch]$Forcar
)

$ErrorActionPreference = "Stop"
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$OutputEncoding = [Text.UTF8Encoding]::new($false)
$env:PYTHONUTF8 = "1"
$env:PYTHONIOENCODING = "utf-8"

$scriptsDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectDir = Split-Path -Parent $scriptsDir
$python = Join-Path $projectDir ".venv\Scripts\python.exe"

if (-not (Test-Path -LiteralPath $python -PathType Leaf)) {
    Write-Host "ERRO: Python do bot nao encontrado: $python" -ForegroundColor Red
    exit 2
}

$arguments = @(
    "-m", "gudybot", "transcrever", $Session,
    "--model", $Modelo,
    "--language", $Idioma,
    "--chunk-seconds", ([string]($MinutosPorTrecho * 60))
)
if ($Glossario) {
    $arguments += @("--glossary", (Resolve-Path -LiteralPath $Glossario).Path)
}
if ($Forcar) {
    $arguments += "--force"
}

Push-Location $projectDir
try {
    & $python @arguments
    exit $LASTEXITCODE
}
finally {
    Pop-Location
}
