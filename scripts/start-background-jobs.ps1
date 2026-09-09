# Starts the long-running narration jobs as genuinely detached processes.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/start-background-jobs.ps1
#
# The render and upload were previously launched with `nohup ... &` from a
# shell, and kept dying part way through - not from any fault of their own, but
# because they stayed inside the launching shell's process tree and went down
# with it. Start-Process detaches them properly, so they survive the session
# that started them.
#
# Both jobs are resumable: the render skips books already on disk and the
# uploader skips assets already hosted, so re-running this is always safe and
# never repeats finished work.

param(
  [switch]$RenderOnly,
  [switch]$UploadOnly
)

$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

function Running($pattern) {
  @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
    Where-Object { $_.CommandLine -like "*$pattern*" }).Count
}

# Spawns a process that is NOT a child of this one. WmiPrvSE services the call,
# so the new process escapes whatever job object this session lives in and keeps
# running after the session ends. Returns nothing useful beyond throwing if the
# call is refused; a non-zero ReturnValue means the process never started.
function Start-Detached($commandLine, $workingDir) {
  $r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
    CommandLine      = $commandLine
    CurrentDirectory = $workingDir
  }
  if ($r.ReturnValue -ne 0) {
    throw "Win32_Process.Create refused '$commandLine' (ReturnValue $($r.ReturnValue))"
  }
}

if (-not $UploadOnly) {
  if ((Running 'build-narration.js') -gt 0) {
    Write-Output "render: already running, left alone"
  } else {
    # The voice order is the render queue; finished voices are skipped in
    # seconds, so passing the whole list every time is the simplest way to
    # resume without tracking where it stopped.
    # Bible in Basic English comes before the last two King James voices on
    # purpose. KJV already has eight narrators published and BBE has none at
    # all, so every BBE listener falls back to the device synthesiser - the
    # robotic one this whole effort exists to replace. The ninth KJV voice is
    # worth far less than the first BBE voice.
    #
    # BBE reuses the KJV narrator names deliberately: the app keys positions on
    # a book slug, so someone who switches translation mid-chapter keeps both
    # their place and the voice they chose.
    #
    # Only models whose .onnx.json sits next to the .onnx are listed. cori has
    # no config on disk, so a "bbe:cori" here would fail on every cycle the way
    # rvr:alonso silently did for six days - piper exits 1 with empty stderr.
    $voices = @(
      'kjv:abel','rvr:pilar','kjv:miriam','kjv:reuben','rvr:alonso',
      'kjv:naomi','kjv:silas','rvr:rodrigo',
      'bbe:linda','bbe:hannah','bbe:abel','bbe:miriam',
      'kjv:esther','kjv:jonah'
    )
    # Node, not bash. The shell driver ran perfectly in the foreground and
    # silently did nothing when detached from PowerShell - a login shell's cd,
    # a PATH without /usr/bin, and the redirect quoting each broke it in a way
    # that left no trace in the log. Node detaches reliably.
    #
    # Launched through WMI rather than Start-Process. Start-Process leaves the
    # child inside the launching session's Windows job object, so the render
    # dies whenever that session is torn down - which happened at 01:30 on
    # 2026-09-01 with no reboot and no line in render.log, and cost about a day
    # of rendering before anyone noticed. Win32_Process.Create is serviced by
    # WmiPrvSE, so the new process is parented outside this session and outlives
    # it. Task Scheduler would be the tidier home for this, but registering a
    # task needs elevation on this machine and is refused.
    Start-Detached ("node.exe scripts\render-queue.js " + ($voices -join ' ')) $repo
    Write-Output "render: started detached"
  }
}

if (-not $RenderOnly) {
  if ((Running 'upload-narration.js') -gt 0) {
    Write-Output "upload: already running, left alone"
  } else {
    Start-Detached 'cmd.exe /c node.exe upload-narration.js >> upload.out 2>> upload.err' $repo
    Write-Output "upload: started detached"
  }
}
