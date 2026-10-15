@echo off
setlocal EnableExtensions
set "WINDOW_COLS=100"
set "WINDOW_ROWS=30"
if /I not "%~1"=="__GERADOR_CONHOST" if defined WT_SESSION (
  start "" "%SystemRoot%\System32\conhost.exe" "%ComSpec%" /d /c ""%~f0" __GERADOR_CONHOST"
  exit /b 0
)
if /I "%~1"=="__GERADOR_CONHOST" shift
cd /d "%~dp0"
title Gerador de Imagens IA Local - Diagnostico
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\window.ps1" -Columns %WINDOW_COLS% -Rows %WINDOW_ROWS%
cls

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\header.ps1" -Section "Diagnostico"
echo   Carregando verificacoes...
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\diagnostico.ps1"
set "RC=%ERRORLEVEL%"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\footer.ps1"
echo.
pause
exit /b %RC%
