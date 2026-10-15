$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

function Banner($t){ Write-Host ''; Write-Host '============================================================' -ForegroundColor DarkGray; Write-Host $t -ForegroundColor Cyan; Write-Host '============================================================' -ForegroundColor DarkGray }
function Refresh-Path { $env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User') }

Banner 'Gerador de Imagens IA Local 2.5.1 - instalacao do nucleo'
Write-Host 'O nucleo e pequeno. Chat, imagem e video sao ativados depois pela propria pagina.' -ForegroundColor White

if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) {
  if (-not (Get-Command winget.exe -ErrorAction SilentlyContinue)) { throw 'Node.js nao encontrado e winget indisponivel.' }
  Write-Host 'Instalando Node.js LTS...' -ForegroundColor Yellow
  winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
  Refresh-Path
}
if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) { throw 'Node.js ainda nao esta disponivel. Reinicie o terminal e execute novamente.' }

Banner 'Dependencias da interface'
& npm install --no-fund --no-audit
if ($LASTEXITCODE -ne 0) { throw 'npm install falhou.' }

Banner 'Nucleo instalado'
Write-Host 'Execute ABRIR.bat.' -ForegroundColor Green
Write-Host 'No primeiro acesso, ative o Chat Local; os demais recursos podem ser instalados quando quiser.' -ForegroundColor Green
