@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -Command "$done=$false; for($p=3000;$p -le 3015;$p++){try{$j=Invoke-RestMethod -UseBasicParsing ('http://127.0.0.1:'+ $p +'/api/ping') -TimeoutSec 1;if($j.app -in @('GeradorImagensIALocal','QwenStudioLocal')){Invoke-RestMethod -Method Post -UseBasicParsing ('http://127.0.0.1:'+ $p +'/api/shutdown') -TimeoutSec 2|Out-Null;$done=$true}}catch{}}; if($done){Write-Host 'Gerador de Imagens IA Local encerrado.' -ForegroundColor Green}else{Write-Host 'Nenhuma instancia encontrada.' -ForegroundColor Yellow}"
timeout /t 2 /nobreak >nul
