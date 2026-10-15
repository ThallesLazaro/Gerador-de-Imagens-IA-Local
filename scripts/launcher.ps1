$ErrorActionPreference='SilentlyContinue'

for($p=3000;$p -le 3015;$p++){
  try{
    $j=Invoke-RestMethod -UseBasicParsing -Uri ("http://127.0.0.1:$p/api/ping") -TimeoutSec 1
    if($j.app -eq 'GeradorImagensIALocal'){
      $url="http://127.0.0.1:$p"
      Clear-Host
      Write-Host ''
      Write-Host '  Gerador de Imagens IA Local' -ForegroundColor Cyan
      Write-Host '  Tutorial: ' -NoNewline -ForegroundColor Gray
      Write-Host 'https://youtu.be/YQbrUucNrRE' -ForegroundColor Green
      Write-Host '  ----------------------------------------------------------' -ForegroundColor DarkGray
      Write-Host '   Servidor local ja estava ativo.' -ForegroundColor Yellow
      Write-Host '   Aplicativo: ' -NoNewline -ForegroundColor Gray
      Write-Host $url -ForegroundColor Green
      Start-Process $url
      exit 20
    }
    if($j.app -eq 'QwenStudioLocal'){
      try{ Invoke-RestMethod -Method Post -Headers @{'X-Gerador-Local'='1'} -UseBasicParsing -Uri ("http://127.0.0.1:$p/api/shutdown") -TimeoutSec 2 | Out-Null }catch{}
      Start-Sleep -Milliseconds 250
    }
  }catch{}
}
exit 0
