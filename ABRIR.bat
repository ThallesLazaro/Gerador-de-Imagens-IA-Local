@echo off
setlocal EnableExtensions
set "WINDOW_COLS=64"
set "WINDOW_ROWS=12"
if /I not "%~1"=="__GERADOR_CONHOST" if defined WT_SESSION (
  start "" "%SystemRoot%\System32\conhost.exe" "%ComSpec%" /d /c ""%~f0" __GERADOR_CONHOST"
  exit /b 0
)
if /I "%~1"=="__GERADOR_CONHOST" shift
cd /d "%~dp0"
title Gerador de Imagens IA Local
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\window.ps1" -Columns %WINDOW_COLS% -Rows %WINDOW_ROWS%
cls

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\header.ps1" -Section "Inicializacao"
echo   Carregando servidor local...
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo   [ERRO] Node.js nao encontrado.
  echo   Execute INSTALAR.bat primeiro.
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\footer.ps1"
  echo.
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\launcher.ps1"
if "%ERRORLEVEL%"=="20" (
  timeout /t 2 /nobreak >nul
  exit /b 0
)

echo   Iniciando o servidor...
echo   Esta janela pode ficar minimizada durante o uso.
set "GERADOR_OPEN_BROWSER=1"
set "GERADOR_WINDOW_COLS=%WINDOW_COLS%"
set "GERADOR_WINDOW_ROWS=%WINDOW_ROWS%"
node server.js
set "RC=%ERRORLEVEL%"

cls
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\header.ps1"
echo   Servidor encerrado.
if not "%RC%"=="0" (
  echo   [ERRO] Codigo de saida: %RC%.
  echo.
  pause
)
exit /b %RC%
