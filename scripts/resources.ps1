param(
  [Parameter(Mandatory=$true)][string]$Resource,
  [ValidateSet('install','repair','remove')][string]$Action='install'
)
$ErrorActionPreference='Stop'
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

$script:LastProgress=0
function P([int]$n,[string]$m){ $safe=[Math]::Max($script:LastProgress,[Math]::Min(100,[Math]::Max(0,$n))); $script:LastProgress=$safe; Write-Output "[PROGRESS $safe] $m" }
function Refresh-Path { $env:Path=[Environment]::GetEnvironmentVariable('Path','Machine')+';'+[Environment]::GetEnvironmentVariable('Path','User') }
function Ensure-Dir([string]$p){ New-Item -ItemType Directory -Force -Path $p | Out-Null }
function Assert-SafeLeaf([string]$value,[string]$label){
  if([string]::IsNullOrWhiteSpace($value)){ return }
  if([System.IO.Path]::GetFileName($value) -ne $value -or $value -in @('.','..') -or $value -match '[\\/:*?"<>|]'){
    throw "$label contem um nome de arquivo/pasta inseguro. Use apenas um nome simples, sem barras ou caminhos relativos."
  }
}
function Assert-SafeDownloadUrl([string]$url){
  if([string]::IsNullOrWhiteSpace($url)){ throw 'URL de download vazia.' }
  if($url -match '[\r\n"]'){ throw 'URL de download contem caracteres inseguros.' }
  $uri=$null
  if(-not [System.Uri]::TryCreate($url,[System.UriKind]::Absolute,[ref]$uri)){ throw 'URL de download invalida.' }
  if($uri.UserInfo){ throw 'URL com usuario/senha embutidos nao e permitida.' }
  $uriHost=$uri.Host.ToLowerInvariant()
  $localHttp=($uri.Scheme -eq 'http' -and $uriHost -in @('127.0.0.1','localhost'))
  if($uri.Scheme -ne 'https' -and -not $localHttp){ throw 'Downloads remotos precisam usar HTTPS. HTTP e aceito apenas em localhost/127.0.0.1.' }
}
function Validate-EnvironmentInputs {
  foreach($item in @(
    @($env:QSL_FILENAME,'Nome do modelo de chat'),
    @($env:QSL_DIFFUSION_FILENAME,'Nome do denoiser'),
    @($env:QSL_ENCODER_FILENAME,'Nome do encoder'),
    @($env:QSL_MMPROJ_FILENAME,'Nome do mmproj'),
    @($env:QSL_VAE_FILENAME,'Nome do VAE'),
    @($env:QSL_CHAT_FILENAME,'Nome compartilhado do chat'),
    @($env:QSL_IMAGE_ENCODER_FILENAME,'Nome compartilhado do encoder'),
    @($env:QSL_VIDEO_FOLDER,'Pasta do modelo de video')
  )){ if($item[0]){ Assert-SafeLeaf ([string]$item[0]) ([string]$item[1]) } }
  if($env:QSL_VIDEO_REPO -and $env:QSL_VIDEO_REPO -notmatch '^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$'){ throw 'Repo ID de video invalido.' }
}
function Assert-SafeArchivePath([string]$entry){
  if([string]::IsNullOrWhiteSpace($entry)){ return }
  $v=$entry.Replace('\','/')
  $parts=@($v.Split('/') | Where-Object { $_ -ne '' })
  if($v.StartsWith('/') -or $v -match '^[A-Za-z]:' -or $parts -contains '..'){
    throw "Pacote inseguro: caminho interno fora da pasta de destino foi bloqueado ($entry)."
  }
}
function Test-PEExecutable([string]$file){
  # Nao use tamanho minimo alto aqui. Alguns binarios recentes sao pequenos
  # porque carregam a implementacao principal por DLLs ao lado do executavel.
  # Validamos a estrutura PE real: MZ + ponteiro e_lfanew + assinatura PE\0\0.
  $fs=$null
  try{
    if(-not (Test-Path -LiteralPath $file -PathType Leaf)){ return $false }
    $item=Get-Item -LiteralPath $file -ErrorAction Stop
    if($item.Length -lt 68){ return $false }

    $fs=[System.IO.File]::Open($file,[System.IO.FileMode]::Open,[System.IO.FileAccess]::Read,[System.IO.FileShare]::ReadWrite)
    $dos=New-Object byte[] 64
    if($fs.Read($dos,0,64) -ne 64){ return $false }
    if($dos[0] -ne 0x4D -or $dos[1] -ne 0x5A){ return $false }

    $peOffset=[BitConverter]::ToInt32($dos,0x3C)
    if($peOffset -lt 64 -or $peOffset -gt ($item.Length-4)){ return $false }
    $fs.Seek($peOffset,[System.IO.SeekOrigin]::Begin) | Out-Null
    $sig=New-Object byte[] 4
    if($fs.Read($sig,0,4) -ne 4){ return $false }
    return ($sig[0] -eq 0x50 -and $sig[1] -eq 0x45 -and $sig[2] -eq 0x00 -and $sig[3] -eq 0x00)
  } catch { return $false }
  finally { if($fs){ try { $fs.Dispose() } catch {} } }
}
function Find-ValidExecutable([string]$base,[string]$name){
  if(-not (Test-Path $base)){ return $null }
  return Get-ChildItem $base -Filter $name -File -Recurse -ErrorAction SilentlyContinue |
    Where-Object { Test-PEExecutable $_.FullName } |
    Select-Object -First 1
}
function Get-RemainingGB([string]$dest,[double]$expectedGB){
  if($expectedGB -le 0){ return 0 }
  $have=0.0
  try { if(Test-Path $dest){ $have=(Get-Item $dest).Length/1000000000.0 } } catch {}
  return [Math]::Max(0.0,$expectedGB-$have)
}
function Assert-FreeSpace([double]$requiredGB,[string]$label){
  if($requiredGB -le 0){ return }
  try{
    $qualifier=Split-Path -Qualifier $Root
    if(-not $qualifier){ return }
    $driveName=$qualifier.TrimEnd(':')
    $drive=Get-PSDrive -Name $driveName -ErrorAction Stop
    $freeGB=$drive.Free/1000000000.0
    $needed=$requiredGB+0.75
    if($freeGB -lt $needed){ throw ("Espaco em disco insuficiente para {0}. Livre: {1:N2} GB; necessario aproximadamente: {2:N2} GB incluindo margem temporaria." -f $label,$freeGB,$needed) }
    Write-Output ("Espaco em disco: {0:N2} GB livres | falta baixar ~{1:N2} GB para {2}" -f $freeGB,$requiredGB,$label)
  } catch {
    if($_.Exception.Message -match 'Espaco em disco insuficiente'){ throw }
    Write-Output 'Nao foi possivel calcular o espaco livre; a instalacao continuara e validara eventuais erros de disco.'
  }
}
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
  if($dest -match '(?i)\.zip$'){
    try{
      Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction SilentlyContinue
      $zip=[System.IO.Compression.ZipFile]::OpenRead($dest)
      $count=$zip.Entries.Count
      $zip.Dispose()
      if($count -lt 1){ return $false }
    } catch { return $false }
  }
  if($dest -match '(?i)\.7z$'){
    try{
      $fs=[System.IO.File]::OpenRead($dest)
      $buf=New-Object byte[] 6
      if($fs.Read($buf,0,6) -ne 6){ $fs.Dispose(); return $false }
      $fs.Dispose()
      $sig=@(0x37,0x7A,0xBC,0xAF,0x27,0x1C)
      for($i=0;$i -lt 6;$i++){ if($buf[$i] -ne $sig[$i]){ return $false } }
    } catch { return $false }
  }
  return $true
}
function Test-DownloadMarker([string]$marker,[string]$url,[double]$expectedGB=0){
  if(-not (Test-Path $marker)){ return $false }
  try{
    $raw=(Get-Content $marker -Raw -Encoding UTF8).Trim()
    if($raw -eq 'ok'){
      # Marcadores legados sao confiaveis apenas para arquivos conhecidos pelo
      # catalogo, pois o tamanho esperado diferencia as variantes oficiais.
      return ($expectedGB -gt 0)
    }
    $meta=$raw | ConvertFrom-Json
    return ($meta.url -eq $url)
  } catch { return $false }
}
function Write-DownloadMarker([string]$marker,[string]$url,[string]$dest){
  $bytes=0
  try { $bytes=(Get-Item $dest).Length } catch {}
  $meta=[ordered]@{ url=$url; bytes=$bytes; completedAt=(Get-Date).ToString('o') } | ConvertTo-Json -Compress
  Set-Content -Path $marker -Value $meta -Encoding UTF8
}
function Download-Resume([string]$url,[string]$dest,[double]$expectedGB=0,[int]$stageStart=0,[int]$stageEnd=0){
  Assert-SafeDownloadUrl $url
  Ensure-Dir (Split-Path -Parent $dest)
  $marker=$dest+'.complete'
  $name=Split-Path -Leaf $dest

  if((Test-Path $dest) -and (Test-DownloadMarker $marker $url $expectedGB) -and (Test-DownloadedFile $dest $expectedGB)){
    Write-Output "Ja existe e foi validado: $name"
    if($stageEnd -gt $stageStart){ P $stageEnd "$name ja esta instalado" }
    return
  }

  # Se o arquivo chegou a 100% em uma execucao anterior, mas o curl terminou
  # com erro de resume/HTTP antes de criarmos o marcador, aproveitamos o arquivo.
  if($expectedGB -gt 0 -and (Test-Path $dest) -and (Test-DownloadedFile $dest $expectedGB)){
    Write-DownloadMarker $marker $url $dest
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
  Write-DownloadMarker $marker $url $dest
  if($stageEnd -gt $stageStart){ P $stageEnd "$name baixado e validado" }
}
function Expand-Release([object]$asset,[string]$dest){
  $assetName=[string]$asset.name
  Assert-SafeLeaf $assetName 'Nome do pacote de release'
  if($assetName -notmatch '(?i)\.(zip|7z)$'){ throw 'O pacote de release possui uma extensao inesperada.' }
  $cacheDir=Join-Path $env:TEMP 'GeradorImagensIALocal-downloads'
  Ensure-Dir $cacheDir
  $archive=Join-Path $cacheDir $assetName
  Download-Resume $asset.browser_download_url $archive
  Ensure-Dir $dest
  try{
    if($archive.ToLower().EndsWith('.zip')){
      Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction SilentlyContinue
      $zip=[System.IO.Compression.ZipFile]::OpenRead($archive)
      try { foreach($entry in $zip.Entries){ Assert-SafeArchivePath ([string]$entry.FullName) } }
      finally { $zip.Dispose() }
      Expand-Archive -Path $archive -DestinationPath $dest -Force
    }
    elseif($archive.ToLower().EndsWith('.7z')){
      $seven=Get-Command 7z.exe -ErrorAction SilentlyContinue
      if(-not $seven -and (Get-Command winget.exe -ErrorAction SilentlyContinue)){ winget install --id 7zip.7zip -e --accept-source-agreements --accept-package-agreements; Refresh-Path; $seven=Get-Command 7z.exe -ErrorAction SilentlyContinue }
      if(-not $seven){ throw '7-Zip necessario para extrair o backend.' }
      $listing=& $seven.Source l -slt $archive
      if($LASTEXITCODE -ne 0){ throw '7-Zip nao conseguiu inspecionar o backend antes da extracao.' }
      $entriesStarted=$false
      foreach($line in @($listing)){
        if($line -match '^----------'){ $entriesStarted=$true; continue }
        if($entriesStarted -and $line -match '^Path = (.*)$'){ Assert-SafeArchivePath ([string]$Matches[1]) }
      }
      & $seven.Source x -y "-o$dest" $archive | Out-Null
      if($LASTEXITCODE -ne 0){ throw '7-Zip nao conseguiu extrair o backend.' }
    } else { throw "Formato de release nao suportado: $($asset.name)" }
    Remove-Item $archive -Force -ErrorAction SilentlyContinue
    Remove-Item ($archive + '.complete') -Force -ErrorAction SilentlyContinue
  } catch {
    Remove-Item ($archive + '.complete') -Force -ErrorAction SilentlyContinue
    throw
  }
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
  $found=Find-ValidExecutable "$Root\runtime\llama" 'llama-server.exe'
  if($found){ Write-Output "llama.cpp ja instalado e validado: $($found.FullName)"; return }
  $invalid=@(Get-ChildItem "$Root\runtime\llama" -Filter llama-server.exe -File -Recurse -ErrorAction SilentlyContinue)
  if($invalid.Count){
    Write-Output 'llama-server.exe existente parece invalido; o backend sera baixado novamente.'
    $invalid | ForEach-Object { Remove-Item $_.FullName -Force -ErrorAction SilentlyContinue }
  }

  P 12 'Baixando llama.cpp para o Chat local'
  $asset=Get-GitHubWindowsAsset @('ggml-org/llama.cpp','ggerganov/llama.cpp') 'llama'
  if(-not $asset){
    throw 'Nao encontrei um binario Windows x64 recente do llama.cpp. Verifique sua conexao com api.github.com ou tente novamente mais tarde.'
  }

  Expand-Release $asset "$Root\runtime\llama"
  $found=Find-ValidExecutable "$Root\runtime\llama" 'llama-server.exe'
  if(-not $found){
    throw "O pacote '$($asset.name)' foi extraido, mas nenhum llama-server.exe valido foi encontrado."
  }
  Write-Output "llama-server.exe pronto e validado: $($found.FullName)"
}
function Ensure-SdCpp {
  Ensure-Dir "$Root\runtime\sd"
  $found=Find-ValidExecutable "$Root\runtime\sd" 'sd-cli.exe'
  if($found){ Write-Host "stable-diffusion.cpp ja instalado e validado: $($found.FullName)" -ForegroundColor Green; return }
  $invalid=@(Get-ChildItem "$Root\runtime\sd" -Filter sd-cli.exe -File -Recurse -ErrorAction SilentlyContinue)
  if($invalid.Count){
    Write-Host 'sd-cli.exe existente parece invalido; o backend sera baixado novamente.' -ForegroundColor Yellow
    $invalid | ForEach-Object { Remove-Item $_.FullName -Force -ErrorAction SilentlyContinue }
  }

  P 18 'Baixando stable-diffusion.cpp'
  $asset=Get-GitHubWindowsAsset @('leejet/stable-diffusion.cpp') 'sd'
  if(-not $asset){
    throw 'Nao encontrei um binario Windows x64 recente do stable-diffusion.cpp. Verifique sua conexao com api.github.com ou tente novamente mais tarde.'
  }

  Expand-Release $asset "$Root\runtime\sd"
  $found=Find-ValidExecutable "$Root\runtime\sd" 'sd-cli.exe'
  if(-not $found){
    throw "O pacote '$($asset.name)' foi extraido, mas nenhum sd-cli.exe valido foi encontrado."
  }
  Write-Host "sd-cli.exe pronto e validado: $($found.FullName)" -ForegroundColor Green
}
function Ensure-FFmpeg {
  $local=Get-ChildItem "$Root\runtime\ffmpeg" -Filter ffmpeg.exe -File -Recurse -ErrorAction SilentlyContinue | Where-Object { Test-PEExecutable $_.FullName } | Select-Object -First 1
  if($local){ return }
  $sys=Get-Command ffmpeg.exe -ErrorAction SilentlyContinue
  if($sys -and -not (Test-PEExecutable $sys.Source)){ $sys=$null }

  # Se o ambiente de Video IA ja possui imageio-ffmpeg, podemos reutilizar o
  # binario empacotado ali sem varrer o disco inteiro.
  if(-not $sys){
    $imgio=Get-ChildItem "$Root\runtime\video-python\Lib\site-packages\imageio_ffmpeg\binaries" -Filter 'ffmpeg*.exe' -File -ErrorAction SilentlyContinue | Where-Object { Test-PEExecutable $_.FullName } | Select-Object -First 1
    if($imgio){ $sys=$imgio }
  }
  if(-not $sys -and (Get-Command winget.exe -ErrorAction SilentlyContinue)){
    P 20 'Instalando FFmpeg'
    winget install --id Gyan.FFmpeg -e --accept-source-agreements --accept-package-agreements
    Refresh-Path
    $sys=Get-Command ffmpeg.exe -ErrorAction SilentlyContinue
    if($sys -and -not (Test-PEExecutable $sys.Source)){ $sys=$null }
  }
  if(-not $sys){
    # WinGet pode instalar o pacote antes de atualizar o PATH da sessao.
    $wingetRoot="$env:LOCALAPPDATA\Microsoft\WinGet\Packages"
    if(Test-Path $wingetRoot){ $sys=Get-ChildItem $wingetRoot -Filter ffmpeg.exe -File -Recurse -ErrorAction SilentlyContinue | Where-Object { Test-PEExecutable $_.FullName } | Select-Object -First 1 }
  }
  if(-not $sys){ throw 'FFmpeg nao encontrado. Instale pelo WinGet ou use Reparar / aplicar novamente.' }
  Ensure-Dir "$Root\runtime\ffmpeg"
  $src=if($sys.Source){$sys.Source}else{$sys.FullName}
  Copy-Item $src "$Root\runtime\ffmpeg\ffmpeg.exe" -Force
  if(-not (Test-PEExecutable "$Root\runtime\ffmpeg\ffmpeg.exe")){ throw 'O FFmpeg encontrado nao parece ser um executavel Windows valido.' }
}
function Get-Python311Command {
  $py=Get-Command py.exe -ErrorAction SilentlyContinue
  if($py){
    & $py.Source -3.11 -c "import sys; raise SystemExit(0 if sys.version_info[:2] == (3,11) else 1)" 2>$null
    if($LASTEXITCODE -eq 0){ return [pscustomobject]@{ Exe=$py.Source; Prefix=@('-3.11') } }
  }
  $python=Get-Command python.exe -ErrorAction SilentlyContinue
  if($python){
    & $python.Source -c "import sys; raise SystemExit(0 if sys.version_info[:2] == (3,11) else 1)" 2>$null
    if($LASTEXITCODE -eq 0){ return [pscustomobject]@{ Exe=$python.Source; Prefix=@() } }
  }
  return $null
}
function Ensure-Python311 {
  $cmd=Get-Python311Command
  if(-not $cmd){
    if(-not (Get-Command winget.exe -ErrorAction SilentlyContinue)){ throw 'Python 3.11 necessario e winget indisponivel.' }
    P 15 'Instalando Python 3.11'
    winget install --id Python.Python.3.11 -e --accept-source-agreements --accept-package-agreements
    Refresh-Path
    $cmd=Get-Python311Command
  }
  if(-not $cmd){ throw 'Python 3.11 foi solicitado, mas nao ficou disponivel nesta sessao. Execute Reparar / aplicar novamente.' }

  $venv="$Root\runtime\video-python"
  $venvPython="$venv\Scripts\python.exe"
  $validVenv=$false
  if(Test-Path $venvPython){
    & $venvPython -c "import sys; raise SystemExit(0 if sys.version_info[:2] == (3,11) else 1)" 2>$null
    $validVenv=($LASTEXITCODE -eq 0)
  }
  if(-not $validVenv){
    if(Test-Path $venv){ Remove-Item $venv -Recurse -Force -ErrorAction SilentlyContinue }
    P 25 'Criando ambiente Python 3.11 isolado para video'
    $invokeArgs=@(); $invokeArgs += @($cmd.Prefix); $invokeArgs += @('-m','venv',$venv)
    & $cmd.Exe @invokeArgs
    if($LASTEXITCODE -ne 0 -or -not (Test-Path $venvPython)){ throw 'Falha ao criar ambiente Python 3.11.' }
  }
}
function Test-VideoModelLayout([string]$dir){
  if(-not (Test-Path $dir)){ return $false }
  $modelIndex=Get-ChildItem $dir -Filter model_index.json -File -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
  if(-not $modelIndex){ return $false }
  $weight=Get-ChildItem $dir -File -Recurse -ErrorAction SilentlyContinue | Where-Object { ($_.Extension -ieq '.safetensors' -or $_.Extension -ieq '.bin') -and $_.Length -gt 10485760 } | Select-Object -First 1
  return [bool]$weight
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

Validate-EnvironmentInputs
if($Action -eq 'remove'){ Remove-Resource $Resource; exit 0 }

switch($Resource){
  'chat' {
    P 5 'Preparando Chat Qwen local'
    Ensure-LlamaCpp
    $url = $env:QSL_URL
    $name = $env:QSL_FILENAME
    if(-not $url -or -not $name){ throw 'Modelo de chat sem URL/nome. Edite modelos.json e tente novamente.' }
    if($name -notmatch '(?i)\.gguf$'){ throw 'O modelo personalizado do chat deve terminar em .gguf.' }
    $chatTarget="$Root\models\shared\$name"
    $chatSize=[double]$env:QSL_SIZE_GB
    Assert-FreeSpace (Get-RemainingGB $chatTarget $chatSize) 'Chat local'
    P 35 'Baixando modelo Qwen de conversa'
    Download-Resume $url $chatTarget $chatSize 35 96
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
    $mmTarget = "$Root\models\shared\$mmName"
    $vaeTarget = "$Root\models\image\vae\$vaeName"
    $imageRemaining=(Get-RemainingGB $diffTarget ([double]$env:QSL_DIFFUSION_SIZE_GB)) + (Get-RemainingGB $sharedEncoder ([double]$env:QSL_ENCODER_SIZE_GB)) + (Get-RemainingGB $mmTarget ([double]$env:QSL_MMPROJ_SIZE_GB)) + (Get-RemainingGB $vaeTarget ([double]$env:QSL_VAE_SIZE_GB))
    Assert-FreeSpace $imageRemaining 'Geracao de imagem'

    P 28 'Baixando denoiser Qwen Image 2.1 Turbo'
    Download-Resume $diffUrl $diffTarget ([double]$env:QSL_DIFFUSION_SIZE_GB) 28 48
    P 50 'Verificando encoder AtomicChat Sem Censura compartilhado'
    Download-Resume $encUrl $sharedEncoder ([double]$env:QSL_ENCODER_SIZE_GB) 50 70
    P 70 'Baixando projetor visual'
    Download-Resume $mmUrl $mmTarget ([double]$env:QSL_MMPROJ_SIZE_GB) 70 82
    P 82 'Baixando VAE Qwen Image 2.1'
    Download-Resume $vaeUrl $vaeTarget ([double]$env:QSL_VAE_SIZE_GB) 82 97
    P 100 'Geracao de imagem instalada'
  }
  'video-light' { Ensure-FFmpeg; P 100 'Video leve instalado' }
  'videoLight' { Ensure-FFmpeg; P 100 'Video leve instalado' }
  'video-ai' {
    P 5 'Preparando motor de video IA'
    Ensure-Python311
    Ensure-FFmpeg
    $python="$Root\runtime\video-python\Scripts\python.exe"
    P 35 'Instalando ambiente auditado de Video IA'
    & $python -m pip install --upgrade pip
    if($LASTEXITCODE -ne 0){ throw 'Falha ao atualizar o pip do ambiente de video.' }
    $requirements="$Root\scripts\video-requirements.txt"
    if(-not (Test-Path $requirements)){ throw 'Arquivo scripts/video-requirements.txt nao encontrado.' }
    & $python -m pip install --no-cache-dir -r $requirements
    if($LASTEXITCODE -ne 0){ throw 'Falha ao instalar bibliotecas Python de video.' }

    P 58 'Validando bibliotecas do motor de video'
    $smoke="import torch,diffusers,transformers; from PIL import Image; from diffusers import LTXPipeline; from diffusers.utils import export_to_video; print('torch='+torch.__version__+' diffusers='+diffusers.__version__+' transformers='+transformers.__version__)"
    $smokeOutput=& $python -c $smoke
    if($LASTEXITCODE -ne 0){ throw 'As bibliotecas foram instaladas, mas o runner LTX nao passou no teste de importacao.' }
    if($smokeOutput){ Write-Output $smokeOutput }
    $envMarkerPath="$Root\runtime\video-python\.gerador-video-env.json"
    $envMarkerData=[ordered]@{
      validatedAt=(Get-Date).ToString('o')
      installerVersion=$(if($env:QSL_APP_VERSION){$env:QSL_APP_VERSION}else{'desconhecida'})
      smoke=[string]($smokeOutput -join ' ')
    } | ConvertTo-Json
    Set-Content -Path $envMarkerPath -Value $envMarkerData -Encoding UTF8

    P 65 'Baixando modelo de video'
    $repo = $env:QSL_VIDEO_REPO
    if(-not $repo){ throw 'Modelo de video sem repo_id. Edite modelos.json e tente novamente.' }
    $folder = $env:QSL_VIDEO_FOLDER
    if(-not $folder){ $folder='LTX-Video' }
    $videoDir = "$Root\models\video\$folder"
    $existingMarker=Join-Path $videoDir '.gerador-video-installed.json'
    if(Test-Path $existingMarker){
      try{
        $existingMeta=Get-Content $existingMarker -Raw -Encoding UTF8 | ConvertFrom-Json
        if($existingMeta.repo -and $existingMeta.repo -ne $repo){
          Write-Output "A pasta local pertence a outro repo ($($existingMeta.repo)); limpando antes de aplicar $repo."
          Remove-Item $videoDir -Recurse -Force -ErrorAction Stop
        }
      } catch {
        if(Test-Path $existingMarker){ Write-Output 'Marcador antigo do modelo de video nao pode ser lido; o download sera validado novamente.' }
      }
    }
    $env:GERADOR_HF_REPO=$repo
    $env:GERADOR_HF_DIR=$videoDir
    $code="import os; from huggingface_hub import snapshot_download; snapshot_download(repo_id=os.environ['GERADOR_HF_REPO'], local_dir=os.environ['GERADOR_HF_DIR'])"
    & $python -c $code
    if($LASTEXITCODE -ne 0){ throw 'Falha ao baixar o modelo de video.' }
    if(-not (Test-VideoModelLayout $videoDir)){ throw 'O download terminou, mas o modelo de video esta incompleto: model_index.json ou arquivos de pesos nao foram encontrados.' }

    # O marcador registra metadados, mas a deteccao de instalado tambem exige
    # model_index.json e pesos reais; portanto um download parcial nao fica verde.
    $markerPath = Join-Path $videoDir '.gerador-video-installed.json'
    $markerData = [ordered]@{
      repo = $repo
      folder = $folder
      installedAt = (Get-Date).ToString('o')
      installerVersion = $(if($env:QSL_APP_VERSION){$env:QSL_APP_VERSION}else{'desconhecida'})
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
