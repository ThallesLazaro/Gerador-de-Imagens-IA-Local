$ErrorActionPreference='SilentlyContinue'
$Root=Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

function Read-Json([string]$file){
  try { return (Get-Content $file -Raw -Encoding UTF8 | ConvertFrom-Json) } catch { return $null }
}
function Get-Variant([object]$catalog,[object]$config,[string]$id){
  $resource=$catalog.recursos.$id
  if(-not $resource){ return $null }
  $selected=$config.$id.variant
  if(-not $selected){ $selected=$resource.defaultVariant }
  $variant=$resource.variants | Where-Object { $_.id -eq $selected } | Select-Object -First 1
  if(-not $variant){ $variant=$resource.variants | Select-Object -First 1 }
  return [pscustomobject]@{ Id=$selected; Variant=$variant; Config=$config.$id }
}
function Pick([object]$sel,[string]$key){
  if($sel.Config -and $sel.Config.$key){ return [string]$sel.Config.$key }
  if($sel.Variant -and $sel.Variant.$key){ return [string]$sel.Variant.$key }
  return ''
}
function Test-NonEmpty([string]$file){ try { return (Test-Path $file) -and ((Get-Item $file).Length -gt 1024) } catch { return $false } }
function Test-Gguf([string]$file){
  try{
    if(-not (Test-NonEmpty $file)){ return $false }
    $fs=[System.IO.File]::OpenRead($file); $b=New-Object byte[] 4; $n=$fs.Read($b,0,4); $fs.Dispose()
    return ($n -eq 4 -and [System.Text.Encoding]::ASCII.GetString($b) -eq 'GGUF')
  } catch { return $false }
}
function Test-Safetensors([string]$file){
  try{
    if(-not (Test-NonEmpty $file)){ return $false }
    $fs=[System.IO.File]::OpenRead($file); if($fs.Length -lt 16){$fs.Dispose();return $false}
    $b=New-Object byte[] 8; if($fs.Read($b,0,8)-ne 8){$fs.Dispose();return $false}; $len=[System.BitConverter]::ToUInt64($b,0); $first=$fs.ReadByte(); $total=$fs.Length; $fs.Dispose()
    return ($len -ge 2 -and $len -le 104857600 -and ($len+8) -lt $total -and $first -eq 123)
  } catch { return $false }
}
function Test-PE([string]$file){
  try{
    if(-not (Test-Path $file) -or (Get-Item $file).Length -lt 65536){return $false}
    $fs=[System.IO.File]::OpenRead($file); $a=$fs.ReadByte();$b=$fs.ReadByte();$fs.Dispose(); return ($a -eq 0x4D -and $b -eq 0x5A)
  } catch { return $false }
}


$catalog=Read-Json 'modelos.json'
$config=Read-Json 'model-config.json'

Write-Output 'Verificando ambiente local...'
Write-Output ''
if(Get-Command node.exe -ErrorAction SilentlyContinue){ Write-Output '[OK] Node.js encontrado' } else { Write-Output '[ERRO] Node.js nao encontrado' }
if(Test-Path 'node_modules'){ Write-Output '[OK] node_modules existe' } else { Write-Output '[ERRO] node_modules ausente - execute INSTALAR.bat' }
Write-Output ''
Write-Output 'Modelos selecionados:'
if($catalog -and $config){
  $chat=Get-Variant $catalog $config 'chat'
  $image=Get-Variant $catalog $config 'image'
  $video=Get-Variant $catalog $config 'videoAI'
  Write-Output ("Chat:     {0}" -f $chat.Id)
  Write-Output ("Imagem:   {0}" -f $image.Id)
  Write-Output ("Video IA: {0}" -f $video.Id)
} else {
  Write-Output '[ERRO] modelos.json ou model-config.json nao puderam ser lidos'
}

Write-Output ''
Write-Output 'Recursos locais:'
if($catalog -and $config){
  $chat=Get-Variant $catalog $config 'chat'
  $image=Get-Variant $catalog $config 'image'
  $video=Get-Variant $catalog $config 'videoAI'

  $chatFile=Pick $chat 'filename'
  if($chatFile -and (Test-Gguf (Join-Path 'models\shared' $chatFile))){ Write-Output "[OK] Chat GGUF: $chatFile" } else { Write-Output '[--] Chat GGUF selecionado nao instalado ou incompleto' }

  $diff=Pick $image 'diffusionFilename'
  $enc=Pick $image 'encoderFilename'
  $mm=Pick $image 'mmprojFilename'
  $vae=Pick $image 'vaeFilename'
  $imgOk=$true
  foreach($pair in @(
    @('Denoiser', (Join-Path 'models\image\diffusion' $diff), 'gguf'),
    @('Encoder', (Join-Path 'models\shared' $enc), 'gguf'),
    @('Projetor', (Join-Path 'models\shared' $mm), 'gguf'),
    @('VAE', (Join-Path 'models\image\vae' $vae), 'safetensors')
  )){
    $valid=if($pair[2] -eq 'gguf'){Test-Gguf $pair[1]}else{Test-Safetensors $pair[1]}
    if($pair[1] -and $valid){ Write-Output ("[OK] {0}: {1}" -f $pair[0],(Split-Path -Leaf $pair[1])) }
    else { Write-Output ("[--] {0} ausente, incompleto ou invalido" -f $pair[0]); $imgOk=$false }
  }

  $videoFolder=Pick $video 'folder'; if(-not $videoFolder){ $videoFolder='LTX-Video' }
  $videoDir=Join-Path 'models\video' $videoFolder
  $modelIndex=Get-ChildItem $videoDir -Filter model_index.json -File -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
  $weight=Get-ChildItem $videoDir -File -Recurse -ErrorAction SilentlyContinue | Where-Object { ($_.Extension -ieq '.safetensors' -or $_.Extension -ieq '.bin') -and $_.Length -gt 10485760 } | Select-Object -First 1
  if($modelIndex -and $weight){ Write-Output "[OK] Video IA: $videoFolder" } else { Write-Output '[--] Video IA nao instalado ou incompleto' }
}

if(Test-Path 'runtime\video-python\Scripts\python.exe'){
  & 'runtime\video-python\Scripts\python.exe' -c "import sys; raise SystemExit(0 if sys.version_info[:2] == (3,11) else 1)" 2>$null
  if($LASTEXITCODE -eq 0 -and (Test-Path 'runtime\video-python\.gerador-video-env.json')){ Write-Output '[OK] Python isolado de video 3.11 + ambiente LTX validado' }
  elseif($LASTEXITCODE -eq 0){ Write-Output '[--] Python 3.11 existe, mas o ambiente LTX precisa de Reparar / aplicar' }
  else { Write-Output '[ERRO] Ambiente Python de video existe, mas nao e Python 3.11 valido' }
} else { Write-Output '[--] Python de video nao instalado' }

$llama=Get-ChildItem 'runtime\llama' -Filter 'llama-server.exe' -File -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
$sd=Get-ChildItem 'runtime\sd' -Filter 'sd-cli.exe' -File -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
$ff=Get-ChildItem 'runtime\ffmpeg' -Filter 'ffmpeg.exe' -File -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
if($llama -and (Test-PE $llama.FullName)){ Write-Output "[OK] llama-server: $($llama.FullName)" } else { Write-Output '[--] llama-server nao encontrado' }
if($sd -and (Test-PE $sd.FullName)){ Write-Output "[OK] sd-cli: $($sd.FullName)" } else { Write-Output '[--] sd-cli nao encontrado' }
if($ff -and (Test-PE $ff.FullName)){ Write-Output "[OK] ffmpeg: $($ff.FullName)" } else { Write-Output '[--] ffmpeg local nao encontrado' }

Write-Output ''
Write-Output 'Servidor local:'
$found=$null
for($p=3000;$p -le 3015;$p++){
  try{
    $j=Invoke-RestMethod -UseBasicParsing -Uri ("http://127.0.0.1:$p/api/ping") -TimeoutSec 1
    if($j.app -eq 'GeradorImagensIALocal'){ $found="http://127.0.0.1:$p"; break }
  }catch{}
}
if($found){ Write-Output "[OK] Aplicativo ativo em $found" } else { Write-Output '[--] Servidor nao esta em execucao' }
Write-Output ''
Write-Output 'Diagnostico concluido.'
