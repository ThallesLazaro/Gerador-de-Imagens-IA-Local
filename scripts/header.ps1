param(
  [string]$Section=''
)
$App='Gerador de Imagens IA Local'
$Tutorial='https://youtu.be/YQbrUucNrRE'
try { $w=[int]$Host.UI.RawUI.WindowSize.Width } catch { $w=68 }
$len=[Math]::Max(24,[Math]::Min(60,$w-4))
$divider='-' * $len
Write-Host ''
Write-Host ('  ' + $App) -ForegroundColor Cyan
Write-Host '  Tutorial: ' -NoNewline -ForegroundColor Gray
Write-Host $Tutorial -ForegroundColor Green
Write-Host ('  ' + $divider) -ForegroundColor DarkGray
if($Section){
  Write-Host ('  ' + $Section) -ForegroundColor White
  Write-Host ''
}
