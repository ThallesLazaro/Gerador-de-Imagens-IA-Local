$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

function Banner($t){ Write-Host ''; Write-Host '============================================================' -ForegroundColor DarkGray; Write-Host $t -ForegroundColor Cyan; Write-Host '============================================================' -ForegroundColor DarkGray }
function Refresh-Path { $env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User') }
function Get-NodeMajor {
  try {
    if(-not (Get-Command node.exe -ErrorAction SilentlyContinue)){ return 0 }
    $major=& node.exe -p "Number(process.versions.node.split('.')[0])"
    if($LASTEXITCODE -ne 0){ return 0 }
    return [int]$major
  } catch { return 0 }
}

Banner 'Gerador de Imagens IA Local - instalacao do nucleo'
Write-Host 'O nucleo e pequeno. Chat, imagem e video sao ativados depois pela propria pagina.' -ForegroundColor White

$nodeMajor=Get-NodeMajor
if ($nodeMajor -lt 18) {
  if ($nodeMajor -gt 0){ Write-Host "Node.js $nodeMajor encontrado, mas esta versao e antiga para o servidor atual." -ForegroundColor Yellow }
  if (-not (Get-Command winget.exe -ErrorAction SilentlyContinue)) { throw 'Node.js 18+ nao encontrado e winget indisponivel.' }
  Write-Host 'Instalando/atualizando Node.js LTS...' -ForegroundColor Yellow
  winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
  Refresh-Path
  $nodeMajor=Get-NodeMajor
}
if ($nodeMajor -lt 18) { throw 'Node.js 18+ ainda nao esta disponivel. Feche esta janela, abra INSTALAR.bat novamente e tente outra vez.' }
if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue) -and -not (Get-Command npm.exe -ErrorAction SilentlyContinue)) { throw 'npm nao foi encontrado junto do Node.js.' }
Write-Host "Node.js compativel detectado: v$(& node.exe -p 'process.versions.node')" -ForegroundColor Green

Banner 'Dependencias da interface'
& npm install --omit=dev --no-fund --no-audit --save-exact
if ($LASTEXITCODE -ne 0) { throw 'npm install falhou.' }

Write-Host 'Validando dependencias do servidor...' -ForegroundColor Yellow
& node.exe -e "Promise.all([import('express'),import('multer')]).then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1)})"
if ($LASTEXITCODE -ne 0) { throw 'Express/Multer foram instalados, mas o Node.js nao conseguiu carrega-los.' }

Banner 'Nucleo instalado'
Write-Host 'Execute ABRIR.bat.' -ForegroundColor Green
Write-Host 'No primeiro acesso, ative o Chat Local; os demais recursos podem ser instalados quando quiser.' -ForegroundColor Green
