param()
$ErrorActionPreference='Stop'
$compiler='C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$source=Join-Path $PSScriptRoot 'GalaxyAtlasLauncher.cs'
$target=Join-Path $PSScriptRoot 'GalaxyAtlas.exe'
$icon=Join-Path $PSScriptRoot 'galaxy-atlas.ico'
if (!(Test-Path -LiteralPath $compiler -PathType Leaf)) { throw 'Windows C# compiler unavailable' }
& $compiler '/nologo' '/target:winexe' '/platform:anycpu' '/optimize+' '/warnaserror+' (('/out:')+$target) (('/win32icon:')+$icon) $source
if($LASTEXITCODE -ne 0){throw 'Galaxy Atlas launcher compilation failed'}
$bytes=[IO.File]::ReadAllBytes($target)
$offset=[BitConverter]::ToInt32($bytes,0x3c)
if([BitConverter]::ToUInt32($bytes,$offset) -ne 0x00004550 -or [BitConverter]::ToUInt16($bytes,$offset+24+68) -ne 2){throw 'Expected a Windows GUI executable'}
$version=[Diagnostics.FileVersionInfo]::GetVersionInfo($target)
$report=[ordered]@{path=$target;sha256=(Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant();bytes=$bytes.Length;subsystem='Windows GUI';product=$version.ProductName;widget='@galaxy-atlas/desktop';dataDirectory='galaxy-atlas-desktop';executed=$false}
$report|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $PSScriptRoot 'launcher-build-report.json') -Encoding utf8
$report|ConvertTo-Json
