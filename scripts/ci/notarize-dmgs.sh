#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${APPLE_ID:-}" || -z "${APPLE_APP_SPECIFIC_PASSWORD:-}" || -z "${APPLE_TEAM_ID:-}" ]]; then
  echo "Skipping DMG notarization because Apple notarization credentials are not configured."
  exit 0
fi

found_dmg=0
while IFS= read -r dmg_path; do
  found_dmg=1
  echo "Submitting DMG for notarization: ${dmg_path}"

  submission_output="$(
    xcrun notarytool submit "${dmg_path}" \
      --apple-id "${APPLE_ID}" \
      --password "${APPLE_APP_SPECIFIC_PASSWORD}" \
      --team-id "${APPLE_TEAM_ID}" \
      --wait \
      --output-format json
  )"
  printf '%s\n' "${submission_output}"

  submission_status="$(printf '%s\n' "${submission_output}" | sed -nE 's/.*"status"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p' | head -n1 | tr '[:upper:]' '[:lower:]')"
  if [[ "${submission_status}" != "accepted" ]]; then
    submission_id="$(printf '%s\n' "${submission_output}" | sed -nE 's/.*"id"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p' | head -n1)"
    if [[ -n "${submission_id}" ]]; then
      xcrun notarytool log "${submission_id}" \
        --apple-id "${APPLE_ID}" \
        --password "${APPLE_APP_SPECIFIC_PASSWORD}" \
        --team-id "${APPLE_TEAM_ID}" || true
    fi
    echo "DMG notarization failed for ${dmg_path}." >&2
    exit 1
  fi

  xcrun stapler staple "${dmg_path}"
  xcrun stapler validate "${dmg_path}"
done < <(find dist -maxdepth 5 -type f -name '*.dmg' | sort)

if [[ "${found_dmg}" -eq 0 ]]; then
  echo "No DMG artifact found in dist/ to notarize."
fi
