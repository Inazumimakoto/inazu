#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_DIR="${1:-"$ROOT_DIR/public/assets/backgrounds"}"
MAX_SIZE="${BACKGROUND_MAX_SIZE:-2400}"
QUALITY="${BACKGROUND_QUALITY:-84}"

if ! command -v magick >/dev/null 2>&1; then
    echo "error: ImageMagick is required. Install it with: brew install imagemagick" >&2
    exit 1
fi

if [[ ! -d "$TARGET_DIR" ]]; then
    echo "error: background directory not found: $TARGET_DIR" >&2
    exit 1
fi

removed_ds_store=0
while IFS= read -r -d '' file; do
    rm -f "$file"
    removed_ds_store=$((removed_ds_store + 1))
done < <(find "$TARGET_DIR" -type f -name '.DS_Store' -print0)

needs_sanitize() {
    local file="$1"
    local dimensions profiles width height

    if ! dimensions="$(magick identify -quiet -format '%w %h' "$file" 2>/dev/null)"; then
        return 0
    fi

    read -r width height <<<"$dimensions"

    if [[ "$width" -gt "$MAX_SIZE" || "$height" -gt "$MAX_SIZE" ]]; then
        return 0
    fi

    if file "$file" | grep -Eiq 'exif|gps|iptc|xmp'; then
        return 0
    fi

    profiles="$(magick identify -quiet -format '%[profiles]' "$file" 2>/dev/null || true)"
    if [[ -n "$profiles" ]]; then
        return 0
    fi

    return 1
}

processed=0
skipped=0
failed=0

while IFS= read -r -d '' file; do
    if ! needs_sanitize "$file"; then
        skipped=$((skipped + 1))
        continue
    fi

    ext="${file##*.}"
    tmp="${file}.sanitized-$$.${ext}"

    if magick "$file" \
        -auto-orient \
        -strip \
        -resize "${MAX_SIZE}x${MAX_SIZE}>" \
        -quality "$QUALITY" \
        "$tmp"; then
        mv "$tmp" "$file"
        processed=$((processed + 1))
    else
        rm -f "$tmp"
        echo "error: failed to sanitize $file" >&2
        failed=$((failed + 1))
    fi
done < <(find "$TARGET_DIR" -type f \( \
    -iname '*.jpg' -o \
    -iname '*.jpeg' -o \
    -iname '*.png' -o \
    -iname '*.webp' \
\) -print0)

echo "Removed .DS_Store files: $removed_ds_store"
echo "Sanitized image files: $processed"
echo "Skipped clean image files: $skipped"
echo "Failed image files: $failed"

if [[ "$failed" -gt 0 ]]; then
    exit 1
fi
