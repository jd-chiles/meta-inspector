#!/usr/bin/env bash
set -euo pipefail

# Build the project's bounded server-side frame decoder from an authenticated
# FFmpeg source release. The app needs the MOV demuxer, H.264/HEVC/MPEG-4
# decoders, selected-frame filters, and the MJPEG image mux path only.
version="9.0.2"
prefix="${FFMPEG_INSTALL_PREFIX:-${HOME}/.local/ffmpeg-${version}}"
build_dir="$(mktemp -d "${TMPDIR:-/tmp}/move-in-ready-ffmpeg.XXXXXX")"
gnupg_dir="$(mktemp -d "${TMPDIR:-/tmp}/move-in-ready-gnupg.XXXXXX")"
jobs="${FFMPEG_BUILD_JOBS:-2}"

cleanup() {
  rm -rf "$build_dir" "$gnupg_dir"
}
trap cleanup EXIT

if ! [[ "$jobs" =~ ^[1-9][0-9]*$ ]]; then
  echo "FFMPEG_BUILD_JOBS must be a positive integer." >&2
  exit 2
fi

for command_name in curl gpg tar make gcc; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Missing build tool: $command_name. Install it before building FFmpeg $version." >&2
    exit 2
  fi
done

configure_assembly=()
if ! command -v nasm >/dev/null 2>&1; then
  # This worker image does not include NASM. The bounded workload decodes at
  # most 30 source stills per short clip, so FFmpeg's portable software
  # decoders are sufficient; NASM-enabled builds remain the default when
  # the tool is available.
  configure_assembly+=(--disable-x86asm)
  echo "NASM is unavailable; building FFmpeg $version with portable software decoders." >&2
fi

archive="ffmpeg-${version}.tar.xz"
base_url="https://ffmpeg.org/releases"

if ! curl --fail --location --silent --show-error --connect-timeout 8 --max-time 20 --retry 1 --retry-delay 1 \
  "$base_url/$archive" --output "$build_dir/$archive"; then
  # Use the unchanged upstream archive from a distribution mirror, then verify
  # its signature against FFmpeg's pinned release key below.
  curl --fail --location --silent --show-error --connect-timeout 10 --max-time 120 \
    "https://mirrors.slackware.com/slackware/slackware64-current/source/l/ffmpeg/$archive" \
    --output "$build_dir/$archive"
fi
if ! curl --fail --location --silent --show-error --connect-timeout 8 --max-time 12 \
  "$base_url/$archive.asc" --output "$build_dir/$archive.asc"; then
  # The signature is identical to upstream; the source mirror serves it with
  # the release archive.
  curl --fail --location --silent --show-error --connect-timeout 10 --max-time 30 \
    "https://mirrors.slackware.com/slackware/slackware64-current/source/l/ffmpeg/$archive.asc" \
    --output "$build_dir/$archive.asc"
fi

export GNUPGHOME="$gnupg_dir"
curl --fail --location --silent --show-error --connect-timeout 10 --max-time 30 --retry 2 --retry-delay 2 \
  https://ffmpeg.org/ffmpeg-devel.asc | gpg --batch --import
fingerprint="$(gpg --batch --with-colons --fingerprint | awk -F: '$1 == "fpr" { print $10; exit }')"
if [ "$fingerprint" != "FCF986EA15E6E293A5644F10B4322F04D67658D8" ]; then
  echo "FFmpeg release signing key fingerprint did not match the pinned upstream key." >&2
  exit 1
fi
gpg --batch --verify "$build_dir/$archive.asc" "$build_dir/$archive"

tar --extract --xz --file "$build_dir/$archive" --directory "$build_dir"
cd "$build_dir/ffmpeg-${version}"

./configure \
  --prefix="$prefix" \
  --disable-doc \
  --disable-debug \
  --disable-network \
  --disable-autodetect \
  --disable-everything \
  --enable-ffmpeg \
  --enable-protocol=file \
  --enable-demuxer=mov \
  --enable-decoder=h264,hevc,mpeg4 \
  --enable-parser=h264,hevc,mpeg4video \
  --enable-filter=select,showinfo,scale \
  --enable-encoder=mjpeg \
  --enable-muxer=image2 \
  "${configure_assembly[@]}"

make -j"$jobs"
make install

binary="$prefix/bin/ffmpeg"
"$binary" -version | head -n 1
"$binary" -hide_banner -demuxers | grep -Eq '[[:space:]]mov(,|[[:space:]])'
"$binary" -hide_banner -decoders | grep -Eq '[[:space:]]h264[[:space:]]'
"$binary" -hide_banner -decoders | grep -Eq '[[:space:]]hevc[[:space:]]'
"$binary" -hide_banner -decoders | grep -Eq '[[:space:]]mpeg4[[:space:]]'
"$binary" -hide_banner -encoders | grep -Eq '[[:space:]]mjpeg[[:space:]]'
"$binary" -hide_banner -filters | grep -Eq '[[:space:]]select[[:space:]]'
"$binary" -hide_banner -filters | grep -Eq '[[:space:]]showinfo[[:space:]]'
"$binary" -hide_banner -filters | grep -Eq '[[:space:]]scale[[:space:]]'

echo "Installed verified FFmpeg $version at $binary"
