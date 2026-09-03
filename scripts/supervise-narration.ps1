# Keeps the narration render alive.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/supervise-narration.ps1
#
# The render has died three times in three days and the cause is still not
# pinned down. Once was a Windows reboot. Once the process tree went down with
# the session that launched it. The third time the queue exited with
# STATUS_CONTROL_C_EXIT (0xC000013A) about ten minutes after the launching
# session went idle, having rendered happily for fifteen minutes first.
#
# Each time the symptom was the same: no error, no line in render.log, and
# nobody noticed for hours. Roughly two days of rendering has been lost that
# way, which is far more than the diagnosis is worth.
#
# So this stops diagnosing and starts supervising. It checks every couple of
# minutes and restarts the queue if it is gone. Whatever is killing the render,
# the cost drops from "hours until a human looks" to "about two minutes".
#
# Restarting is always safe: build-narration.js skips books already on disk, so
# a restart resumes rather than repeating. Launch this from the Startup folder
# entry so it lives outside any tool session.

$repo = Split-Path -Parent $PSScriptRoot
$launcher = Join-Path $PSScriptRoot 'start-background-jobs.ps1'
$log = Join-Path $repo 'supervisor.log'
$intervalSeconds = 120

function Note($msg) {
  $line = "{0} {1}" -f (Get-Date -Format 'MM-dd HH:mm:ss'), $msg
  Add-Content -Path $log -Value $line -Encoding utf8
}

function QueueRunning {
  @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like '*render-queue*' }).Count -gt 0
}

# One supervisor is enough. A second would race the first into starting two
# queues, which would have both writing the same book directories.
#
# A named mutex, not a scan of command lines. The first version looked for other
# powershell processes mentioning "supervise-narration", which also matched any
# shell that merely had the path typed into it - so every supervisor saw the
# terminal that launched it, concluded a twin was already running, and exited
# immediately. The log filled with "already running; exiting" and nothing ever
# supervised anything.
$mine = $PID
$mutex = New-Object System.Threading.Mutex($false, 'Global\LanternNarrationSupervisor')
if (-not $mutex.WaitOne(0)) {
  Note "another supervisor already holds the lock; exiting (pid $mine)"
  exit 0
}

Note "supervisor started (pid $mine), checking every ${intervalSeconds}s"

# A heartbeat, so "is the supervisor alive?" has an answer that cannot be faked.
# Looking for a powershell process whose command line mentions this script is
# useless: any shell that merely has the path typed into it matches, so both the
# supervisor's own guard and every later check reported a supervisor that was
# not there. The render sat dead for three and a half hours behind one of those
# false positives. A timestamp this process writes itself cannot lie - if
# heartbeat.txt is older than a few minutes, the supervisor is gone.
$beat = Join-Path $repo 'supervisor-heartbeat.txt'

$restarts = 0
while ($true) {
  Set-Content -Path $beat -Value (Get-Date -Format 'o') -Encoding utf8
  if (-not (QueueRunning)) {
    $restarts++
    Note "queue not running - restart #$restarts"
    try {
      & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $launcher *>&1 |
        ForEach-Object { Note "  $_" }
    } catch {
      Note "  launcher threw: $($_.Exception.Message)"
    }
    Start-Sleep -Seconds 30
    if (QueueRunning) { Note "  queue is up" } else { Note "  queue STILL down after restart" }
  }
  Start-Sleep -Seconds $intervalSeconds
}
