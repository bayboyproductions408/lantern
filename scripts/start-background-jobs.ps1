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

if (-not $UploadOnly) {
  if ((Running 'build-narration.js') -gt 0) {
    Write-Output "render: already running, left alone"
  } else {
    # The voice order is the render queue; finished voices are skipped in
    # seconds, so passing the whole list every time is the simplest way to
    # resume without tracking where it stopped.
    $voices = @(
      'kjv:abel','rvr:pilar','kjv:miriam','kjv:reuben','rvr:alonso',
      'kjv:naomi','kjv:silas','rvr:rodrigo','kjv:esther','kjv:jonah'
    )
    # Node, not bash. The shell driver ran perfectly in the foreground and
    # silently did nothing when detached from PowerShell - a login shell's cd,
    # a PATH without /usr/bin, and the redirect quoting each broke it in a way
    # that left no trace in the log. Node detaches reliably.
    Start-Process -FilePath 'node.exe' -ArgumentList (@('scripts/render-queue.js') + $voices) `
      -WorkingDirectory $repo -WindowStyle Hidden
    Write-Output "render: started detached"
  }
}

if (-not $RenderOnly) {
  if ((Running 'upload-narration.js') -gt 0) {
    Write-Output "upload: already running, left alone"
  } else {
    Start-Process -FilePath 'node.exe' -ArgumentList @('upload-narration.js') `
      -WorkingDirectory $repo -WindowStyle Hidden `
      -RedirectStandardOutput "$repo\upload.out" -RedirectStandardError "$repo\upload.err"
    Write-Output "upload: started detached"
  }
}
