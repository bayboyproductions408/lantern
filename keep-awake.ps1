# Keeps the machine from sleeping while a long job runs.
#
#   powershell -NoProfile -File keep-awake.ps1
#
# The narration render takes days and died overnight when the machine slept.
# This does NOT change the user's power settings - it makes the same
# process-scoped request a media player or installer makes, and Windows drops
# it automatically when this process exits. Nothing to undo, and the machine
# sleeps normally again the moment rendering stops.
#
# ES_SYSTEM_REQUIRED only. The display is allowed to switch off as usual;
# there is no reason to keep a monitor lit for a batch job.

Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class Power {
  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern uint SetThreadExecutionState(uint esFlags);
}
"@

# Written in decimal on purpose: Windows PowerShell parses 0x80000000 as a
# negative Int32 first and then fails the cast to UInt32.
$ES_CONTINUOUS      = [uint32]2147483648
$ES_SYSTEM_REQUIRED = [uint32]1

try {
  $previous = [Power]::SetThreadExecutionState($ES_CONTINUOUS -bor $ES_SYSTEM_REQUIRED)
} catch {
  Write-Output "keep-awake: call failed - $($_.Exception.Message)"
  exit 1
}
# A zero return means Windows refused. So does a null, which is what a failed
# call leaves behind - and treating that as success is how this script first
# reported it was holding the machine awake while doing nothing at all.
if ($null -eq $previous -or $previous -eq 0) {
  Write-Output "keep-awake: request refused by Windows"
  exit 1
}
Write-Output "keep-awake: holding the system awake (display may still sleep)"

# Hold the request open. The state belongs to this thread, so it lasts exactly
# as long as this process and needs no cleanup on the way out.
try {
  while ($true) { Start-Sleep -Seconds 60 }
} finally {
  [void][Power]::SetThreadExecutionState($ES_CONTINUOUS)
  Write-Output "keep-awake: released"
}
