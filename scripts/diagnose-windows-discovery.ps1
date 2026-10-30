# Read-only installation metadata collection. No ACL, client, account or policy changes.
[CmdletBinding()]
param([string]$OutputFile = (Join-Path $PSScriptRoot '..\diagnostics\windows-discovery.json'))
$ErrorActionPreference = 'Stop'
$report = [ordered]@{
  schema = 1
  collectedAt = (Get-Date).ToUniversalTime().ToString('o')
  powershell = $PSVersionTable.PSVersion.ToString()
  is64BitProcess = [Environment]::Is64BitProcess
  is64BitOS = [Environment]::Is64BitOperatingSystem
  osVersion = [Environment]::OSVersion.VersionString
  packages = @()
  runningExecutables = @()
  errors = @()
  note = 'Installation metadata only. No account, cookies, credentials or conversation content.'
}
try {
  $timer = [Diagnostics.Stopwatch]::StartNew()
  # Intentionally broader than the application's current OpenAI-only regex.
  $packages = @(Get-AppxPackage | Where-Object { $_.Name -match '(OpenAI|ChatGPT|Codex)' })
  $timer.Stop()
  $report.queryMilliseconds = $timer.ElapsedMilliseconds
  foreach ($pkg in $packages) {
    $item = [ordered]@{
      name = $pkg.Name
      version = [string]$pkg.Version
      architecture = [string]$pkg.Architecture
      packageFullName = $pkg.PackageFullName
      packageFamilyName = $pkg.PackageFamilyName
      publisher = $pkg.Publisher
      installLocation = $pkg.InstallLocation
      applications = @()
      candidates = @()
      errors = @()
    }
    $candidates = @($pkg.InstallLocation, (Join-Path $pkg.InstallLocation 'app'))
    try {
      $manifest = Get-AppxPackageManifest -Package $pkg.PackageFullName
      foreach ($entry in $manifest.Package.Applications.Application) {
        $item.applications += [ordered]@{ id = [string]$entry.Id; executable = [string]$entry.Executable; entryPoint = [string]$entry.EntryPoint }
        if ($entry.Executable) {
          $exe = [IO.Path]::GetFullPath([IO.Path]::Combine($pkg.InstallLocation, [string]$entry.Executable))
          if ($exe.StartsWith($pkg.InstallLocation + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
            $candidates += [IO.Path]::GetDirectoryName($exe)
          }
        }
      }
    } catch { $item.errors += ('manifest: ' + $_.Exception.Message) }
    foreach ($path in @($candidates | Where-Object { $_ } | Select-Object -Unique)) {
      $candidate = [ordered]@{ path = $path; directoryExists = $false; files = @(); error = $null }
      try {
        $candidate.directoryExists = Test-Path -LiteralPath $path -PathType Container
        # Probe only specific installation files, never the user's data directory.
        foreach ($relative in @('ChatGPT.exe','Codex.exe','codex.exe','resources\app.asar','AppxManifest.xml')) {
          $file = Join-Path $path $relative
          if (Test-Path -LiteralPath $file -PathType Leaf) {
            $info = Get-Item -LiteralPath $file
            $candidate.files += [ordered]@{ name = $relative; bytes = $info.Length }
          }
        }
      } catch { $candidate.error = $_.Exception.Message }
      $item.candidates += $candidate
    }
    $report.packages += $item
  }
} catch { $report.errors += ('package-query: ' + $_.Exception.Message) }
try {
  $report.runningExecutables = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^(ChatGPT|Codex)([.]exe)?$' } | ForEach-Object {
    [ordered]@{ name = $_.Name; executablePath = $_.ExecutablePath }
  })
} catch { $report.errors += ('process-query: ' + $_.Exception.Message) }
$fullPath = [IO.Path]::GetFullPath($OutputFile)
[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($fullPath)) | Out-Null
$json = $report | ConvertTo-Json -Depth 10
[IO.File]::WriteAllText($fullPath, $json, (New-Object System.Text.UTF8Encoding($false)))
Write-Output ('Saved installation-only diagnostic: ' + $fullPath)
Write-Output ('Matching packages: ' + $report.packages.Count)
