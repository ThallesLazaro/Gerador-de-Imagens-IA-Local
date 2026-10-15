@echo off
setlocal EnableExtensions
set "WINDOW_COLS=82"
set "WINDOW_ROWS=28"
if /I not "%~1"=="__GERADOR_CONHOST" if defined WT_SESSION (
  start "" "%SystemRoot%\System32\conhost.exe" "%ComSpec%" /d /c ""%~f0" __GERADOR_CONHOST"
  exit /b 0
)
if /I "%~1"=="__GERADOR_CONHOST" shift
cd /d "%~dp0"
title Gerador de Imagens IA Local - Instalador
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\window.ps1" -Columns %WINDOW_COLS% -Rows %WINDOW_ROWS%
cls

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\header.ps1" -Section "Instalacao"
echo   Carregando instalador...
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1"
set "RC=%ERRORLEVEL%"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\footer.ps1"
echo.
if not "%RC%"=="0" (
  echo   [ERRO] A instalacao terminou com erro. Revise as mensagens acima.
) else (
  echo   [OK] Instalacao concluida. Execute ABRIR.bat para continuar.
)
echo.
pause
exit /b %RC%
