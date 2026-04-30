#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${CLOUDFLARE_ACCOUNT_ID:-}" || -z "${CLOUDFLARE_API_TOKEN:-}" ]]; then
  echo "Missing CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_API_TOKEN." >&2
  exit 1
fi

bucket="${COZEA_UPDATE_BUCKET:-cozea-updates}"
channel="${COZEA_UPDATER_CHANNEL:-latest}"
prefix="${COZEA_UPDATE_PREFIX:-}"
root="ci-artifacts"

if [[ ! -d "${root}" ]]; then
  echo "No ${root}/ directory found. Attach the CircleCI workspace before uploading." >&2
  exit 1
fi

content_type_for() {
  case "$1" in
    *.yml|*.yaml) printf 'text/yaml' ;;
    *.zip) printf 'application/zip' ;;
    *.dmg) printf 'application/x-apple-diskimage' ;;
    *.exe) printf 'application/vnd.microsoft.portable-executable' ;;
    *.blockmap) printf 'application/octet-stream' ;;
    *) printf 'application/octet-stream' ;;
  esac
}

cache_control_for() {
  case "$1" in
    latest*.yml|*.yml|*.yaml) printf 'public, max-age=60, must-revalidate' ;;
    *) printf 'public, max-age=31536000, immutable' ;;
  esac
}

export WRANGLER_SEND_METRICS=false

found_file=0
while IFS= read -r file_path; do
  found_file=1
  file_name="$(basename "${file_path}")"
  object_key="${channel}/${file_name}"
  if [[ -n "${prefix}" ]]; then
    object_key="${prefix%/}/${object_key}"
  fi

  content_type="$(content_type_for "${file_name}")"
  cache_control="$(cache_control_for "${file_name}")"

  echo "Uploading ${file_path} to r2://${bucket}/${object_key}"
  bunx wrangler r2 object put "${bucket}/${object_key}" \
    --file "${file_path}" \
    --content-type "${content_type}" \
    --cache-control "${cache_control}"
done < <(find "${root}" -path '*/dist/*' -type f \( \
  -name '*.yml' -o \
  -name '*.yaml' -o \
  -name '*.zip' -o \
  -name '*.dmg' -o \
  -name '*.exe' -o \
  -name '*.blockmap' \
\) | sort)

if [[ "${found_file}" -eq 0 ]]; then
  echo "No release artifacts found under ${root}/*/dist/." >&2
  exit 1
fi
