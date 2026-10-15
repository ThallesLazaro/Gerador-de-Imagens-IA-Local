@echo off
setlocal EnableExtensions
set "WINDOW_COLS=50"
set "WINDOW_ROWS=11"
if /I not "%~1"=="__GERADOR_CONHOST" if defined WT_SESSION (
  start "" "%SystemRoot%\System32\conhost.exe" "%ComSpec%" /d /c ""%~f0" __GERADOR_CONHOST"
  exit /b 0
)
if /I "%~1"=="__GERADOR_CONHOST" shift
cd /d "%~dp0"
title Gerador de Imagens IA Local - Encerrar
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\window.ps1" -Columns %WINDOW_COLS% -Rows %WINDOW_ROWS%
cls

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\header.ps1" -Section "Encerrar servidor"
echo   Carregando...
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command "$done=$false; for($p=3000;$p -le 3015;$p++){try{$j=Invoke-RestMethod -UseBasicParsing ('http://127.0.0.1:'+ $p +'/api/ping') -TimeoutSec 1;if($j.app -in @('GeradorImagensIALocal','QwenStudioLocal')){Invoke-RestMethod -Method Post -Headers @{'X-Gerador-Local'='1'} -UseBasicParsing ('http://127.0.0.1:'+ $p +'/api/shutdown') -TimeoutSec 2|Out-Null;$done=$true}}catch{}}; if($done){Write-Host '  [OK] Servidor encerrado com sucesso.' -ForegroundColor Green}else{Write-Host '  [--] Nenhuma instancia ativa foi encontrada.' -ForegroundColor Yellow}"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\footer.ps1"
echo.
echo   Esta janela sera fechada automaticamente.
timeout /t 3 /nobreak >nul
exit /b 0
