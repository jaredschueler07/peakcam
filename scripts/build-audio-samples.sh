#!/usr/bin/env bash
# Rebuilds public/game/audio/*.{ogg,m4a} from the CC0 archive.org masters.
#
# Every source is CC0 1.0 from "The Designer's Choice UCS Collection" by
# Nicholas A. Judy; see ../CREDITS.md for the per-file item and path. Run from
# anywhere; pass the directory holding the downloaded masters as $1 (they are
# not committed — they are ~30 MB of WAV).
#
#   ./build-samples.sh /tmp/dl
#
set -euo pipefail
SRC_DIR="${1:?usage: build-samples.sh <dir-with-master-wavs>}"
OUT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# name|master|start|duration|channels|crossfade (crossfade 0 => one-shot)
LAYERS=(
  "wind-bed|wind-bed|33.0|12.0|2|2.0"
  "wind-gust|wind-gust|6.5|12.5|2|0.3"
  "carve-packed|cand-nails|2.0|6.0|1|1.0"
  "carve-powder|carve-powder|0.5|11.0|1|1.5"
  "lift-hum|lift-hum|0.3|5.5|1|0.8"
  "jump-whoosh|jump-whoosh|0|0.75|1|0"
  "land-soft|land-soft|0|1.33|1|0"
  "crash-impact|crash-impact|0|1.44|1|0"
  "ui-tick|ui-tick|0|0.74|1|0"
  "trick-chime|trick-chime|0|2.5|1|0"
)

SR=44100
# Loop beds are matched on integrated loudness: -18 LUFS leaves them just under
# the procedural bed so the Phase 7.1 crossfade enriches rather than swamps it.
LN="I=-18:TP=-1.5:LRA=11"
# One-shots are peak-matched instead. EBU R128 integrated loudness is gated over
# 400 ms blocks, so on a sub-3 s transient it measures the decay tail more than
# the hit and pushes short samples 5-10 dB too quiet. True peak is what actually
# tracks how loud a one-shot reads; relative balance is then set by manifest gain.
PEAK_DBFS=-3.0
# Headroom left on the loop beds before encoding, so Vorbis/AAC overshoot has
# somewhere to go instead of clipping.
LOOP_CEIL_DBFS=-2.0

measure() { # $1 file -> prints "measured_I=..:measured_TP=.." for loudnorm pass 2
  # loudnorm's JSON goes to stderr at INFO level, so this pass cannot be quiet.
  ffmpeg -hide_banner -nostats -i "$1" -af "loudnorm=${LN}:print_format=json" -f null - 2>&1 |
    python3 -c '
import json,sys
raw=sys.stdin.read(); s=json.loads(raw[raw.index("{"):raw.rindex("}")+1])
print(":".join(f"measured_{k}={s['"'"'input_'"'"'+k.lower()]}" for k in ("I","TP","LRA","thresh")) + f":offset={s['"'"'target_offset'"'"']}")'
}

peak_gain() { # $1 file, $2 target dBFS, $3 "cut" to only ever attenuate
  ffmpeg -hide_banner -nostats -i "$1" -af volumedetect -f null - 2>&1 |
    python3 -c "
import re,sys
m=re.search(r'max_volume: (-?[0-9.]+) dB', sys.stdin.read())
g = round($2 - float(m.group(1)), 2) if m else 0.0
print(min(g, 0.0) if '${3:-}' == 'cut' else g)"
}

for spec in "${LAYERS[@]}"; do
  IFS='|' read -r name master start dur ch xf <<< "$spec"
  master_path="$SRC_DIR/$master.wav"
  [ -f "$master_path" ] || { echo "missing master: $master_path" >&2; exit 1; }
  work="$(mktemp -d)"

  # 1. Window, downmix, and land everything on one 44.1 kHz bed. The masters run
  #    up to 192 kHz; -ar is what actually pins the rate, an aresample in -af
  #    gets undone by the encoder negotiating back to the input rate.
  ffmpeg -v error -y -ss "$start" -t "$dur" -i "$master_path" \
    -af "aformat=channel_layouts=$([ "$ch" = 1 ] && echo mono || echo stereo)" \
    -ar "$SR" -c:a pcm_s16le "$work/win.wav"

  if [ "$xf" = 0 ]; then
    # 2a. One-shot: strip leading silence and taper the tail so nothing clicks,
    #     then peak-normalise the result that will actually ship.
    ffmpeg -v error -y -i "$work/win.wav" \
      -af "silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.01,afade=t=out:st=$(python3 -c "print(max(0,$dur-0.06))"):d=0.06" \
      -ar "$SR" -c:a pcm_s16le "$work/trim.wav"
    ffmpeg -v error -y -i "$work/trim.wav" -af "volume=$(peak_gain "$work/trim.wav" "$PEAK_DBFS")dB" \
      -ar "$SR" -c:a pcm_s16le "$work/final.wav"
  else
    # 2b. Loop: two-pass loudnorm (linear, so a steady bed does not pump), then
    #     fold the tail back over the head so the wrap point is inaudible.
    #       out = (tail x-fade head) ++ middle
    #     The end of `middle` is followed by `tail` in the master, so the seam
    #     the loop actually plays is one the recording already contained.
    ffmpeg -v error -y -i "$work/win.wav" \
      -af "loudnorm=${LN}:$(measure "$work/win.wav"):linear=true" \
      -ar "$SR" -c:a pcm_s16le "$work/norm.wav"
    body="$(python3 -c "print(round($dur-$xf,4))")"
    ffmpeg -v error -y -i "$work/norm.wav" -filter_complex "
      [0:a]asplit=3[h][m][t];
      [h]atrim=0:$xf,asetpts=N/SR/TB[head];
      [m]atrim=$xf:$body,asetpts=N/SR/TB[mid];
      [t]atrim=$body:$dur,asetpts=N/SR/TB[tail];
      [tail][head]acrossfade=d=$xf:c1=tri:c2=tri[seam];
      [seam][mid]concat=n=2:v=0:a=1[out]" \
      -map "[out]" -ar "$SR" -c:a pcm_s16le "$work/loop.wav"
    # Peak guard: a couple of the beds are transient-heavy enough that a
    # constant-gain loudnorm leaves them touching 0 dBFS, which the lossy
    # encoders then overshoot into clipping. Attenuate only — limiting here
    # would flatten the very scrape transients that make the carve read.
    ffmpeg -v error -y -i "$work/loop.wav" \
      -af "volume=$(peak_gain "$work/loop.wav" "$LOOP_CEIL_DBFS" cut)dB" \
      -ar "$SR" -c:a pcm_s16le "$work/final.wav"
  fi

  # Homebrew's ffmpeg 8 ships no libvorbis (only the experimental native
  # encoder), so the Ogg leg goes through oggenc from vorbis-tools.
  oggenc -Q -q 4 -o "$OUT_DIR/$name.ogg" "$work/final.wav"
  ffmpeg -v error -y -i "$work/final.wav" -c:a aac -b:a "$([ "$ch" = 1 ] && echo 96k || echo 128k)" \
    -movflags +faststart "$OUT_DIR/$name.m4a"
  rm -rf "$work"
  printf '%-14s %7s ogg  %7s m4a\n' "$name" \
    "$(stat -f%z "$OUT_DIR/$name.ogg")" "$(stat -f%z "$OUT_DIR/$name.m4a")"
done
