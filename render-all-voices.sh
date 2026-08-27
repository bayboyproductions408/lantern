#!/usr/bin/env bash
# Renders every registered narrator that is not finished yet, one voice at a
# time so a single voice completes (and can be published) before the next
# starts. Resumable: books already on disk are skipped.
set -u
SP='C:/Users/domhe/AppData/Local/Temp/claude/C--Dom-Claude-BibleAudio/bb5f9ad2-c3cf-44d3-9e5f-4610869c8080/scratchpad'
FFDIR='C:/Users/domhe/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-9.0-full_build/bin'
export PIPER="$SP/piper/piper/piper.exe"
export PIPER_MODELS="$SP/piper"
export FFMPEG="$FFDIR/ffmpeg.exe"
export FFPROBE="$FFDIR/ffprobe.exe"
# Measured, not guessed: piper already saturates all 16 cores from a single
# process, so throughput is flat from 1 to 14 workers (~90 verses/min either
# way). Four workers with each pinned to one thread measured best - enough to
# overlap ffmpeg's chapter concat with another book's synthesis, without the
# thrash that 14 processes caused.
WORKERS="${WORKERS:-4}"
export OMP_NUM_THREADS=1
export ORT_INTRA_OP_NUM_THREADS=1

for pair in "$@"; do
  tr="${pair%%:*}"; voice="${pair##*:}"
  echo "=============================================================="
  echo "  $tr / $voice   ($(date +%H:%M:%S))"
  echo "=============================================================="
  node build-narration.js "$tr" "$voice" --workers "$WORKERS" || echo "!! $tr/$voice failed"
done
echo "ALL RENDERS FINISHED $(date +%H:%M:%S)"
