# Starts the office at logon and keeps it up, as a Windows Scheduled Task named OriginPixelOffice.
#
#   powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1 -Check       what is registered now (changes nothing)
#   powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1              register it for the signed-in user
#   powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1 -Uninstall   remove it
#
# Registering it means routines run whenever you are logged in, on your Claude plan, without the
# page being open. Anything that sends still waits for your approval. It runs as you (your Claude
# login and connectors), only while you are logged in, and never wakes the machine or changes power
# settings. start-office.cmd restarts a crashed office with backoff; the task restarts the launcher
# itself if it fails, and never starts a second copy.
param([switch]$Check, [switch]$Uninstall)
$ErrorActionPreference = 'Stop'
$name = 'OriginPixelOffice'
$root = Split-Path -Parent $PSScriptRoot
$launcher = Join-Path $root 'start-office.cmd'

function Show-Task {
  $t = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
  if ($null -eq $t) { Write-Host "NOT REGISTERED: the office does not start at logon."; return $false }
  $a = $t.Actions | Select-Object -First 1
  $info = Get-ScheduledTaskInfo -TaskName $name
  Write-Host "REGISTERED: $name ($($t.State))"
  Write-Host "  runs:        $($a.Execute) $($a.Arguments)"
  Write-Host "  working dir: $($a.WorkingDirectory)"
  Write-Host "  as user:     $($t.Principal.UserId) ($($t.Principal.LogonType))"
  Write-Host "  triggers:    $(($t.Triggers | ForEach-Object { $_.CimClass.CimClassName -replace 'MSFT_Task','' -replace 'Trigger','' }) -join ', ')"
  Write-Host "  on failure:  restart $($t.Settings.RestartCount) times every $($t.Settings.RestartInterval); instances: $($t.Settings.MultipleInstances); time limit: $($t.Settings.ExecutionTimeLimit)"
  Write-Host "  last run:    $($info.LastRunTime) (result $($info.LastTaskResult)); next: $($info.NextRunTime)"
  $ok = $a.WorkingDirectory -eq $root -and $a.Arguments -match [regex]::Escape($launcher)
  if (-not $ok) { Write-Host "  PROBLEM: it does not point at $launcher in $root" }
  return $ok
}

if ($Check) { Show-Task | Out-Null; exit 0 }
if ($Uninstall) {
  if (Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue) { Unregister-ScheduledTask -TaskName $name -Confirm:$false; Write-Output "Removed $name." } else { Write-Output "$name was not registered." }
  exit 0
}

$user = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c `"$launcher`"" -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $user
$settings = New-ScheduledTaskSettingsSet -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 5) -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description 'Origin Pixel agents office: start-office.cmd at logon' -Force | Out-Null
Write-Output "Registered $name for $user."
if (-not (Show-Task)) { exit 1 }
