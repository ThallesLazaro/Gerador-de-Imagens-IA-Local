@echo off
setlocal
cd /d "%~dp0"
title Gerador de Imagens IA Local - Instalador
mode con: cols=78 lines=24 >nul 2>nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1"
echo.
pause
