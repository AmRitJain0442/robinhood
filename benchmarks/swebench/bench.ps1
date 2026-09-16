param(
    [ValidateSet('prepare', 'doctor', 'run', 'evaluate')][string]$Action = 'doctor',
    [ValidateSet('pilot', 'full')][string]$Profile = 'pilot',
    [string]$RunId,
    [switch]$Start
)
$ErrorActionPreference = 'Stop'
if (($Action -eq 'run' -or $Action -eq 'evaluate') -and -not $Start) {
    throw 'Nothing started. Pass -Start only when you intend to begin the run.'
}
$scriptPath = (Resolve-Path (Join-Path $PSScriptRoot 'bench.py')).Path
$linuxPath = (& wsl -d Ubuntu -- wslpath -a $scriptPath.Replace('\', '/'))
if ($LASTEXITCODE -ne 0) { throw 'Could not resolve the benchmark path in WSL.' }
$linuxPath = $linuxPath.Trim()
$linuxHome = (& wsl -d Ubuntu -- printenv HOME).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Could not find the WSL home directory.' }
$arguments = @('-d', 'Ubuntu', '--', "$linuxHome/.local/share/robinhood-swebench/venv/bin/python", $linuxPath, $Action, '--profile', $Profile)
if ($Start) { $arguments += '--start' }
if ($RunId) { $arguments += @('--run-id', $RunId) }
& wsl @arguments
exit $LASTEXITCODE
