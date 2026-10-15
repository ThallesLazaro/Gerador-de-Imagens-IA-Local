$ErrorActionPreference='SilentlyContinue'
$Root=Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)

function Find-Qwen {
  for($p=3000;$p -le 3015;$p++){
    try{
      $j=Invoke-RestMethod -UseBasicParsing -Uri ("http://127.0.0.1:$p/api/ping") -TimeoutSec 1
      if($j.app -eq 'GeradorImagensIALocal'){ return $p }
      if($j.app -eq 'QwenStudioLocal'){ try{Invoke-RestMethod -Method Post -UseBasicParsing -Uri ("http://127.0.0.1:$p/api/shutdown") -TimeoutSec 2|Out-Null}catch{}; Start-Sleep -Milliseconds 350 }
    } catch {}
  }
  return $null
}

$existing=Find-Qwen
if($existing){ Start-Process "http://127.0.0.1:$existing"; exit 0 }

$cmd="title Gerador de Imagens IA Local && mode con: cols=44 lines=8 && cls && echo Gerador de Imagens IA Local && echo. && echo Servidor local ativo. && echo A interface abre no navegador. && echo Pode minimizar esta janela. && echo Fechar encerra o servidor. && echo. && node server.js"
$conhost=Join-Path $env:WINDIR 'System32\conhost.exe'
if(Test-Path $conhost){
  Start-Process -FilePath $conhost -ArgumentList 'cmd.exe','/k',$cmd -WorkingDirectory $Root
} else {
  Start-Process -FilePath 'cmd.exe' -ArgumentList '/k',$cmd -WorkingDirectory $Root
}

for($i=0;$i -lt 40;$i++){
  Start-Sleep -Milliseconds 400
  $port=Find-Qwen
  if($port){ Start-Process "http://127.0.0.1:$port"; exit 0 }
}
Write-Host 'O Gerador de Imagens IA Local nao respondeu. Execute DIAGNOSTICO.bat.' -ForegroundColor Red
Read-Host 'Pressione Enter para fechar'
