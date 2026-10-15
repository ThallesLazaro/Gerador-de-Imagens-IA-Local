@echo off
setlocal
cd /d "%~dp0"
title Gerador de Imagens IA Local - Diagnostico
mode con: cols=92 lines=30 >nul 2>nul
echo ============================================================
echo Gerador de Imagens IA Local - Diagnostico
echo ============================================================
echo.
where node >nul 2>nul && (echo [OK] Node.js encontrado) || (echo [ERRO] Node.js nao encontrado)
if exist node_modules (echo [OK] node_modules existe) else (echo [ERRO] node_modules ausente - rode INSTALAR.bat)
echo.
echo Recursos locais:
if exist "models\shared\Qwen-Image-2.1-Turbo-Uncensored-AD-Q4_K.gguf" (echo [OK] Modelo compartilhado Qwen) else (echo [--] Chat/Qwen compartilhado nao instalado)
dir /b "models\image\diffusion\Qwen-Image-2.1-Turbo-*.gguf" >nul 2>nul && (echo [OK] Qwen Image denoiser instalado) || (echo [--] Qwen Image nao instalado)
if exist "models\video\LTX-Video\model_index.json" (echo [OK] LTX-Video pipeline encontrado) else (if exist "models\video\LTX-Video\.gerador-video-installed.json" (echo [OK] Video IA instalado) else (echo [--] Video IA nao instalado))
if exist "runtime\video-python\Scripts\python.exe" (echo [OK] Python isolado de video) else (echo [--] Python de video nao instalado)
for /r "runtime" %%F in (llama-server.exe) do echo [OK] llama-server: %%F
for /r "runtime" %%F in (sd-cli.exe) do echo [OK] sd-cli: %%F
for /r "runtime" %%F in (ffmpeg.exe) do echo [OK] ffmpeg: %%F
echo.
echo Servidor local:
powershell -NoProfile -Command "for($p=3000;$p -le 3015;$p++){try{$j=Invoke-RestMethod -UseBasicParsing ('http://127.0.0.1:'+ $p +'/api/ping') -TimeoutSec 1;if($j.app -eq 'GeradorImagensIALocal'){Write-Host ('[OK] Gerador IA em http://127.0.0.1:'+ $p) -ForegroundColor Green}}catch{}}"
echo.
pause
