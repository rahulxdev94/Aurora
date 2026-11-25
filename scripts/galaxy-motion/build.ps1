param([string]$Output=(Join-Path $PSScriptRoot 'GalaxyAtlasMotion.exe'))
$ErrorActionPreference='Stop'
$framework=Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319'
$references=@('System.Drawing','System.Windows.Forms','System.Web','System.Web.Extensions') | ForEach-Object {"/reference:$framework/$_.dll"}
foreach ($assembly in 'UIAutomationClient','UIAutomationTypes','WindowsBase') {
  $references+="/reference:$framework/WPF/$assembly.dll"
}
Push-Location -LiteralPath $PSScriptRoot
try {
  & "$framework/csc.exe" /nologo /target:winexe /platform:x64 /optimize+ "/out:$Output" $references GalaxyMotionHost.cs MotionChannel.cs GalaxyDockGlint.cs
  if ($LASTEXITCODE) { throw 'Galaxy Atlas motion compilation failed' }
} finally { Pop-Location }
