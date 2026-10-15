param(
  [string]$ExtraLabel='',
  [string]$ExtraUrl=''
)
try { $w=[int]$Host.UI.RawUI.WindowSize.Width } catch { $w=68 }
$len=[Math]::Max(24,[Math]::Min(60,$w-4))
$divider='-' * $len
Write-Host ''
Write-Host ('  ' + $divider) -ForegroundColor DarkGray
Write-Host '  Gerador de Imagens IA Local' -ForegroundColor Cyan
Write-Host '  Tutorial: ' -NoNewline -ForegroundColor Gray
Write-Host 'https://youtu.be/YQbrUucNrRE' -ForegroundColor Green
if($ExtraLabel -and $ExtraUrl){
  Write-Host ("  {0}: " -f $ExtraLabel) -NoNewline -ForegroundColor Gray
  Write-Host $ExtraUrl -ForegroundColor Green
}
Write-Host '  Thalles Lazaro - https://thall.es' -ForegroundColor DarkGray
Write-Host ('  ' + $divider) -ForegroundColor DarkGray
