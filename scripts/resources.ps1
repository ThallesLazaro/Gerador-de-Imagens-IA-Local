param(
  [Parameter(Mandatory=$true)][string]$Resource,
  [ValidateSet('install','repair','remove')][string]$Action='install'
)
$ErrorActionPreference='Stop'
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

function P([int]$n,[string]$m){ Write-Output "[PROGRESS $n] $m" }
function Refresh-Path { $env:Path=[Environment]::GetEnvironmentVariable('Path','Machine')+';'+[Environment]::GetEnvironmentVariable('Path','User') }
function Ensure-Dir([string]$p){ New-Item -ItemType Directory -Force -Path $p | Out-Null }
function Test-DownloadedFile([string]$dest,[double]$expectedGB=0){
  if(-not (Test-Path $dest)){ return $false }
  $item=Get-Item $dest
  if($item.Length -le 0){ return $false }

  # Os tamanhos em modelos.json sao aproximados e seguem GB decimal.
  # GGUFs conhecidos ficam com tolerancia mais estreita. Safetensors pode
  # variar um pouco mais conforme a revisao publicada, entao validamos tambem
  # a estrutura real do arquivo em vez de confiar apenas no tamanho.
  if($expectedGB -gt 0){
    $expectedBytes=$expectedGB*1000000000.0
    $ratio=$item.Length/$expectedBytes
    if($dest -match '(?i)\.safetensors$'){
      if($ratio -lt 0.94 -or $ratio -gt 1.12){ return $false }
    } else {
      if($ratio -lt 0.985 -or $ratio -gt 1.02){ return $false }
    }
  }

  # Para GGUF fazemos uma verificacao barata do cabecalho antes de aceitar
  # um arquivo retomado como completo.
  if($dest -match '(?i)\.gguf$'){
    try{
      $fs=[System.IO.File]::OpenRead($dest)
      $buf=New-Object byte[] 4
      $read=$fs.Read($buf,0,4)
      $fs.Dispose()
      if($read -ne 4){ return $false }
      $magic=[System.Text.Encoding]::ASCII.GetString($buf)
      if($magic -ne 'GGUF'){ return $false }
    } catch { return $false }
  }

  # Safetensors comeca com uint64 little-endian contendo o tamanho do header
  # JSON. Validamos esse comprimento e o primeiro caractere do JSON para evitar
  # aceitar HTML/erro HTTP ou um arquivo obviamente truncado.
  if($dest -match '(?i)\.safetensors$'){
    try{
      $fs=[System.IO.File]::OpenRead($dest)
      if($fs.Length -lt 16){ $fs.Dispose(); return $false }
      $lenBuf=New-Object byte[] 8
      if($fs.Read($lenBuf,0,8) -ne 8){ $fs.Dispose(); return $false }
      $headerLen=[System.BitConverter]::ToUInt64($lenBuf,0)
      if($headerLen -lt 2 -or $headerLen -gt 104857600 -or ($headerLen + 8) -ge $fs.Length){ $fs.Dispose(); return $false }
      $first=$fs.ReadByte()
      $fs.Dispose()
      if($first -ne 123){ return $false } # '{'
    } catch { return $false }
  }
  return $true
}
function Download-Resume([string]$url,[string]$dest,[double]$expectedGB=0,[int]$stageStart=0,[int]$stageEnd=0){
  Ensure-Dir (Split-Path -Parent $dest)
  $marker=$dest+'.complete'
  $name=Split-Path -Leaf $dest

  if((Test-Path $dest) -and (Test-Path $marker) -and (Test-DownloadedFile $dest $expectedGB)){
    Write-Output "Ja existe e foi validado: $name"
    if($stageEnd -gt $stageStart){ P $stageEnd "$name ja esta instalado" }
    return
  }

  # Se o arquivo chegou a 100% em uma execucao anterior, mas o curl terminou
  # com erro de resume/HTTP antes de criarmos o marcador, aproveitamos o arquivo.
  if($expectedGB -gt 0 -and (Test-Path $dest) -and (Test-DownloadedFile $dest $expectedGB)){
    Set-Content -Path $marker -Value 'ok' -Encoding ascii
    Write-Output "Arquivo completo encontrado e validado: $name"
    if($stageEnd -gt $stageStart){ P $stageEnd "$name validado sem novo download" }
    return
  }

  # Marcador antigo sem arquivo valido nao deve esconder corrupcao/parcial.
  Remove-Item $marker -Force -ErrorAction SilentlyContinue

  $curl=Get-Command curl.exe -ErrorAction SilentlyContinue
  if($curl){
    if(Test-Path $dest){ Write-Output "Retomando: $name" } else { Write-Output "Baixando: $name" }
    $argLine='-L --fail --retry 6 --retry-delay 3 --continue-at - --silent --show-error --output "' + $dest + '" "' + $url + '"'
    $proc=Start-Process -FilePath $curl.Source -ArgumentList $argLine -PassThru -NoNewWindow
    $lastBytes=0
    if(Test-Path $dest){ $lastBytes=(Get-Item $dest).Length }
    $lastTime=Get-Date
    while(-not $proc.HasExited){
      Start-Sleep -Milliseconds 900
      $proc.Refresh()
      $bytes=0
      if(Test-Path $dest){ $bytes=(Get-Item $dest).Length }
      $now=Get-Date
      $seconds=[Math]::Max(0.1,($now-$lastTime).TotalSeconds)
      $speedMB=[Math]::Max(0,($bytes-$lastBytes)/1000000.0/$seconds)
      $downloadedGB=$bytes/1000000000.0
      if($expectedGB -gt 0){
        $fraction=[Math]::Min(1,[Math]::Max(0,$downloadedGB/$expectedGB))
        $overall=[Math]::Round($stageStart + (($stageEnd-$stageStart)*$fraction))
        $localPct=[Math]::Round($fraction*100)
        P $overall ("Baixando {0} | {1:N2} / {2:N2} GB | {3}% | ~{4:N1} MB/s" -f $name,$downloadedGB,$expectedGB,$localPct,$speedMB)
      } else {
        if($stageEnd -gt $stageStart){ P $stageStart ("Baixando {0} | {1:N2} GB | ~{2:N1} MB/s" -f $name,$downloadedGB,$speedMB) }
        else { Write-Output ("Download {0} | {1:N2} GB | ~{2:N1} MB/s" -f $name,$downloadedGB,$speedMB) }
      }
      $lastBytes=$bytes
      $lastTime=$now
    }
    $proc.WaitForExit()
    $proc.Refresh()
    $exitCode=$proc.ExitCode
    if($exitCode -ne 0){
      # curl pode retornar erro ao tentar retomar um arquivo que ja estava
      # completo (por exemplo HTTP 416). Validamos o arquivo antes de falhar.
      if(Test-DownloadedFile $dest $expectedGB){
        Write-Output "O downloader retornou codigo $exitCode, mas o arquivo final foi validado e sera reutilizado."
      } else {
        throw "Falha no download ($exitCode): $url"
      }
    }
  } else {
    if($stageEnd -gt $stageStart){ P $stageStart "Baixando $name" } else { Write-Output "Baixando: $name" }
    Invoke-WebRequest -Uri $url -OutFile $dest -UseBasicParsing
  }

  if(-not (Test-DownloadedFile $dest $expectedGB)){
    throw "O download terminou, mas o arquivo nao passou na validacao: $name"
  }
  Set-Content -Path $marker -Value 'ok' -Encoding ascii
  if($stageEnd -gt $stageStart){ P $stageEnd "$name baixado e validado" }
}
function Expand-Release([object]$asset,[string]$dest){
  $archive=Join-Path $env:TEMP $asset.name
  Download-Resume $asset.browser_download_url $archive
  Ensure-Dir $dest
  if($archive.ToLower().EndsWith('.zip')){ Expand-Archive -Path $archive -DestinationPath $dest -Force }
  elseif($archive.ToLower().EndsWith('.7z')){
    $seven=Get-Command 7z.exe -ErrorAction SilentlyContinue
    if(-not $seven -and (Get-Command winget.exe -ErrorAction SilentlyContinue)){ winget install --id 7zip.7zip -e --accept-source-agreements --accept-package-agreements; Refresh-Path; $seven=Get-Command 7z.exe -ErrorAction SilentlyContinue }
    if(-not $seven){ throw '7-Zip necessario para extrair o backend.' }
    & $seven.Source x -y "-o$dest" $archive | Out-Null
  } else { throw "Formato de release nao suportado: $($asset.name)" }
}
function GpuText { try { return ((Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name)-join ' ') } catch { return '' } }
function Pick-WindowsAsset([object[]]$assets,[string]$kind){
  $gpu=GpuText
  $ranked=@()
  foreach($a in @($assets)){
    if(-not $a){ continue }
    $n=[string]$a.name
    if([string]::IsNullOrWhiteSpace($n)){ continue }

    # Releases oficiais mudam de nome com o tempo. Aceitamos qualquer
    # arquivo compactado claramente voltado ao Windows x64/amd64.
    $isArchive = $n -match '(?i)\.(zip|7z)$'
    $isWindows = $n -match '(?i)(^|[-_.])(win|windows)([-_.]|$)'
    $isX64 = $n -match '(?i)(x64|amd64|x86_64)'
    if(-not $isArchive -or -not $isWindows){ continue }

    $score=20
    if($isX64){ $score+=30 }
    if($n -match '(?i)(arm64|aarch64)'){ $score-=200 }
    if($n -match '(?i)(source|src|symbols|debug|dev)'){ $score-=100 }

    if($kind -eq 'llama'){
      # Para chat, CPU x64 e Vulkan sao os pacotes mais portaveis.
      # CUDA recebe prioridade em NVIDIA; Vulkan em Intel/AMD.
      if($n -match '(?i)(cpu)'){ $score+=35 }
      if($n -match '(?i)(vulkan)'){ $score+=45 }
      if($n -match '(?i)(sycl)'){ $score+=20 }
      if($gpu -match '(?i)nvidia'){
        if($n -match '(?i)(cuda|cu12|cu13)'){ $score+=120 }
        elseif($n -match '(?i)vulkan'){ $score+=55 }
      } elseif($gpu -match '(?i)(intel|arc|amd|radeon)'){
        if($n -match '(?i)vulkan'){ $score+=110 }
        elseif($n -match '(?i)sycl'){ $score+=70 }
      }
    } else {
      if($gpu -match '(?i)nvidia'){
        if($n -match '(?i)(cuda|cu12|cu13)'){ $score+=120 }
        if($n -match '(?i)vulkan'){ $score+=40 }
      } elseif($gpu -match '(?i)(intel|arc|amd|radeon)'){
        if($n -match '(?i)vulkan'){ $score+=120 }
      } else {
        if($n -match '(?i)vulkan'){ $score+=30 }
      }
    }

    $ranked += [pscustomobject]@{A=$a;S=$score;N=$n}
  }

  $best=$ranked | Sort-Object S -Descending | Select-Object -First 1
  if($best){
    Write-Host "Pacote Windows escolhido: $($best.N)" -ForegroundColor Cyan
    return $best.A
  }
  return $null
}

function Get-GitHubWindowsAsset([string[]]$Repositories,[string]$kind){
  $headers=@{
    'User-Agent'='GeradorImagensIALocal'
    'Accept'='application/vnd.github+json'
  }
  $errors=@()

  foreach($repo in $Repositories){
    try {
      Write-Host "Consultando releases: $repo" -ForegroundColor DarkGray
      $latest=Invoke-RestMethod -Headers $headers -Uri "https://api.github.com/repos/$repo/releases/latest"
      $asset=Pick-WindowsAsset @($latest.assets) $kind
      if($asset){ return $asset }
    } catch {
      $errors += "$repo/latest: $($_.Exception.Message)"
    }

    # Algumas vezes a release marcada como latest nao publica todos os
    # binarios. Nesse caso examinamos as releases mais recentes.
    try {
      $releases=Invoke-RestMethod -Headers $headers -Uri "https://api.github.com/repos/$repo/releases?per_page=12"
      foreach($rel in @($releases)){
        $asset=Pick-WindowsAsset @($rel.assets) $kind
        if($asset){ return $asset }
      }
    } catch {
      $errors += "$repo/releases: $($_.Exception.Message)"
    }
  }

  if($errors.Count){
    Write-Host 'Detalhes das consultas ao GitHub:' -ForegroundColor DarkYellow
    $errors | ForEach-Object { Write-Host " - $_" -ForegroundColor DarkYellow }
  }
  return $null
}

function Ensure-LlamaCpp {
  Ensure-Dir "$Root\runtime\llama"
  $found=Get-ChildItem "$Root\runtime\llama" -Filter llama-server.exe -File -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
  if($found){ Write-Output "llama.cpp ja instalado: $($found.FullName)"; return }

  P 12 'Baixando llama.cpp para o Chat local'
  $asset=Get-GitHubWindowsAsset @('ggml-org/llama.cpp','ggerganov/llama.cpp') 'llama'
  if(-not $asset){
    throw 'Nao encontrei um binario Windows x64 recente do llama.cpp. Verifique sua conexao com api.github.com ou tente novamente mais tarde.'
  }

  Expand-Release $asset "$Root\runtime\llama"
  $found=Get-ChildItem "$Root\runtime\llama" -Filter llama-server.exe -File -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
  if(-not $found){
    throw "O pacote '$($asset.name)' foi extraido, mas llama-server.exe nao foi encontrado."
  }
  Write-Output "llama-server.exe pronto: $($found.FullName)"
}
function Ensure-SdCpp {
  Ensure-Dir "$Root\runtime\sd"
  $found=Get-ChildItem "$Root\runtime\sd" -Filter sd-cli.exe -File -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
  if($found){ Write-Host "stable-diffusion.cpp ja instalado: $($found.FullName)" -ForegroundColor Green; return }

  P 18 'Baixando stable-diffusion.cpp'
  $asset=Get-GitHubWindowsAsset @('leejet/stable-diffusion.cpp') 'sd'
  if(-not $asset){
    throw 'Nao encontrei um binario Windows x64 recente do stable-diffusion.cpp. Verifique sua conexao com api.github.com ou tente novamente mais tarde.'
  }

  Expand-Release $asset "$Root\runtime\sd"
  $found=Get-ChildItem "$Root\runtime\sd" -Filter sd-cli.exe -File -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
  if(-not $found){
    throw "O pacote '$($asset.name)' foi extraido, mas sd-cli.exe nao foi encontrado."
  }
  Write-Host "sd-cli.exe pronto: $($found.FullName)" -ForegroundColor Green
}
function Ensure-FFmpeg {
  $local=Get-ChildItem "$Root\runtime\ffmpeg" -Filter ffmpeg.exe -File -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
  if($local){ return }
  $sys=Get-Command ffmpeg.exe -ErrorAction SilentlyContinue
  if(-not $sys -and (Get-Command winget.exe -ErrorAction SilentlyContinue)){
    P 20 'Instalando FFmpeg'
    winget install --id Gyan.FFmpeg -e --accept-source-agreements --accept-package-agreements
    Refresh-Path; $sys=Get-Command ffmpeg.exe -ErrorAction SilentlyContinue
  }
  if(-not $sys){
    $roots=@("$env:LOCALAPPDATA\Microsoft\WinGet\Packages","$env:ProgramFiles","${env:ProgramFiles(x86)}")|Where-Object {$_ -and (Test-Path $_)}
    foreach($r in $roots){ $sys=Get-ChildItem $r -Filter ffmpeg.exe -File -Recurse -ErrorAction SilentlyContinue|Select-Object -First 1; if($sys){break} }
  }
  if(-not $sys){ throw 'FFmpeg nao encontrado.' }
  Ensure-Dir "$Root\runtime\ffmpeg"
  $src=if($sys.Source){$sys.Source}else{$sys.FullName}
  Copy-Item $src "$Root\runtime\ffmpeg\ffmpeg.exe" -Force
}
function Ensure-Python311 {
  $py=Get-Command py.exe -ErrorAction SilentlyContinue
  if(-not $py){
    if(-not (Get-Command winget.exe -ErrorAction SilentlyContinue)){ throw 'Python 3.11 necessario e winget indisponivel.' }
    P 15 'Instalando Python 3.11'
    winget install --id Python.Python.3.11 -e --accept-source-agreements --accept-package-agreements
    Refresh-Path
  }
  $venv="$Root\runtime\video-python"
  if(-not (Test-Path "$venv\Scripts\python.exe")){
    P 25 'Criando ambiente Python isolado para video'
    & py -3.11 -m venv $venv
    if($LASTEXITCODE -ne 0){ throw 'Falha ao criar ambiente Python 3.11.' }
  }
}
function Remove-FileAndMarker([string]$file){
  if(-not $file){ return }
  Remove-Item $file -Force -ErrorAction SilentlyContinue
  Remove-Item ($file + '.complete') -Force -ErrorAction SilentlyContinue
}
function Remove-Resource([string]$r){
  $chatName=$env:QSL_CHAT_FILENAME
  $imageEncoder=$env:QSL_IMAGE_ENCODER_FILENAME
  $videoFolder=$env:QSL_VIDEO_FOLDER
  if(-not $videoFolder){ $videoFolder='LTX-Video' }
  switch($r){
    'chat' {
      Remove-Item "$Root\runtime\llama" -Recurse -Force -ErrorAction SilentlyContinue
      if($chatName -and $chatName -ne $imageEncoder){ Remove-FileAndMarker "$Root\models\shared\$chatName" }
    }
    'image' {
      Remove-FileAndMarker "$Root\models\image\diffusion\$($env:QSL_DIFFUSION_FILENAME)"
      Remove-FileAndMarker "$Root\models\shared\$($env:QSL_MMPROJ_FILENAME)"
      Remove-FileAndMarker "$Root\models\image\vae\$($env:QSL_VAE_FILENAME)"
      Remove-Item "$Root\runtime\sd" -Recurse -Force -ErrorAction SilentlyContinue
      if($imageEncoder -and $imageEncoder -ne $chatName){ Remove-FileAndMarker "$Root\models\shared\$imageEncoder" }
    }
    'videoLight' { Remove-Item "$Root\runtime\ffmpeg" -Recurse -Force -ErrorAction SilentlyContinue }
    'video-light' { Remove-Item "$Root\runtime\ffmpeg" -Recurse -Force -ErrorAction SilentlyContinue }
    'videoAI' {
      Remove-Item "$Root\runtime\video-python" -Recurse -Force -ErrorAction SilentlyContinue
      Remove-Item "$Root\models\video\$videoFolder" -Recurse -Force -ErrorAction SilentlyContinue
    }
    'video-ai' {
      Remove-Item "$Root\runtime\video-python" -Recurse -Force -ErrorAction SilentlyContinue
      Remove-Item "$Root\models\video\$videoFolder" -Recurse -Force -ErrorAction SilentlyContinue
    }
  }
  P 100 'Recurso removido'
}

if($Action -eq 'remove'){ Remove-Resource $Resource; exit 0 }

switch($Resource){
  'chat' {
    P 5 'Preparando Chat Qwen local'
    Ensure-LlamaCpp
    $url = $env:QSL_URL
    $name = $env:QSL_FILENAME
    if(-not $url -or -not $name){ throw 'Modelo de chat sem URL/nome. Edite modelos.json e tente novamente.' }
    if($name -notmatch '(?i)\.gguf$'){ throw 'O modelo personalizado do chat deve terminar em .gguf.' }
    P 35 'Baixando modelo Qwen de conversa'
    Download-Resume $url "$Root\models\shared\$name" ([double]$env:QSL_SIZE_GB) 35 96
    P 100 'Chat local instalado'
  }
  'image' {
    P 5 'Preparando geracao de imagem'
    # Limpa arquivos de difusao incorretos criados por uma versao anterior.
    Get-ChildItem "$Root\models\image\diffusion" -Filter 'Qwen-Image-2.1-Turbo-Uncensored-*.gguf' -File -ErrorAction SilentlyContinue | ForEach-Object {
      Write-Output "Removendo modelo de difusao obsoleto: $($_.Name)"
      Remove-FileAndMarker $_.FullName
    }
    Ensure-SdCpp
    $diffUrl = $env:QSL_DIFFUSION_URL
    $diffName = $env:QSL_DIFFUSION_FILENAME
    $encUrl = $env:QSL_ENCODER_URL
    $encName = $env:QSL_ENCODER_FILENAME
    $mmUrl = $env:QSL_MMPROJ_URL
    $mmName = $env:QSL_MMPROJ_FILENAME
    $vaeUrl = $env:QSL_VAE_URL
    $vaeName = $env:QSL_VAE_FILENAME
    if(-not $diffUrl -or -not $diffName -or -not $encUrl -or -not $encName -or -not $mmUrl -or -not $mmName -or -not $vaeUrl -or -not $vaeName){ throw 'Configuracao de imagem incompleta. Edite modelos.json e tente novamente.' }
    if($diffName -notmatch '(?i)\.gguf$' -or $encName -notmatch '(?i)\.gguf$'){ throw 'Denoiser e encoder personalizados devem ser arquivos .gguf compativeis.' }
    $diffTarget = "$Root\models\image\diffusion\$diffName"
    $sharedEncoder = "$Root\models\shared\$encName"

    P 28 'Baixando denoiser Qwen Image 2.1 Turbo'
    Download-Resume $diffUrl $diffTarget ([double]$env:QSL_DIFFUSION_SIZE_GB) 28 48
    P 50 'Verificando encoder AtomicChat Uncensored compartilhado'
    Download-Resume $encUrl $sharedEncoder ([double]$env:QSL_ENCODER_SIZE_GB) 50 70
    P 70 'Baixando projetor visual'
    Download-Resume $mmUrl "$Root\models\shared\$mmName" ([double]$env:QSL_MMPROJ_SIZE_GB) 70 82
    P 82 'Baixando VAE Qwen Image 2.1'
    Download-Resume $vaeUrl "$Root\models\image\vae\$vaeName" ([double]$env:QSL_VAE_SIZE_GB) 82 97
    P 100 'Geracao de imagem instalada'
  }
  'video-light' { Ensure-FFmpeg; P 100 'Video leve instalado' }
  'videoLight' { Ensure-FFmpeg; P 100 'Video leve instalado' }
  'video-ai' {
    P 5 'Preparando motor de video IA'
    Ensure-Python311
    Ensure-FFmpeg
    $python="$Root\runtime\video-python\Scripts\python.exe"
    P 35 'Instalando PyTorch e bibliotecas de video'
    & $python -m pip install --upgrade pip
    & $python -m pip install torch torchvision diffusers transformers accelerate safetensors sentencepiece protobuf huggingface_hub imageio imageio-ffmpeg pillow
    if($LASTEXITCODE -ne 0){ throw 'Falha ao instalar bibliotecas Python de video.' }
    P 65 'Baixando modelo de video'
    $repo = $env:QSL_VIDEO_REPO
    if(-not $repo){ throw 'Modelo de video sem repo_id. Edite modelos.json e tente novamente.' }
    $folder = $env:QSL_VIDEO_FOLDER
    if(-not $folder){ $folder='LTX-Video' }
    $videoDir = "$Root\models\video\$folder"
    $code="from huggingface_hub import snapshot_download; snapshot_download(repo_id='$repo', local_dir=r'$videoDir')"
    & $python -c $code
    if($LASTEXITCODE -ne 0){ throw 'Falha ao baixar o modelo de video.' }

    # O site usa este marcador para reconhecer uma instalação concluída.
    # Não dependemos de model_index.json existir na raiz do repositório.
    $markerPath = Join-Path $videoDir '.gerador-video-installed.json'
    $markerData = [ordered]@{
      repo = $repo
      folder = $folder
      installedAt = (Get-Date).ToString('o')
      installerVersion = '2.5.3'
    } | ConvertTo-Json
    Set-Content -Path $markerPath -Value $markerData -Encoding UTF8
    Write-Output "Modelo de video validado em: $videoDir"
    P 100 'Video IA instalado e ativado' 
  }
  'videoAI' {
    & "$PSCommandPath" -Resource 'video-ai' -Action $Action
  }
  default { throw "Recurso desconhecido: $Resource" }
}
