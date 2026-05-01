#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${CSC_LINK:-}" || -z "${CSC_KEY_PASSWORD:-}" ]]; then
  echo "Missing CSC_LINK or CSC_KEY_PASSWORD for macOS signing." >&2
  exit 1
fi

tmp_dir="$(mktemp -d)"
cert_path="${tmp_dir}/cozea-signing-cert.p12"

case "${CSC_LINK}" in
  http://*|https://*)
    curl -fsSL "${CSC_LINK}" -o "${cert_path}"
    ;;
  file://*)
    cp "${CSC_LINK#file://}" "${cert_path}"
    ;;
  *)
    if [[ -f "${CSC_LINK}" ]]; then
      cp "${CSC_LINK}" "${cert_path}"
    else
      payload="${CSC_LINK#base64:}"
      if [[ "${payload}" == data:* ]]; then
        payload="${payload#*,}"
      fi
      printf '%s' "${payload}" | base64 --decode > "${cert_path}" 2>/dev/null || printf '%s' "${payload}" | base64 -D > "${cert_path}"
    fi
    ;;
esac

keychain_path="${HOME}/Library/Keychains/cozea-ci-signing.keychain-db"
keychain_password="$(openssl rand -hex 16)"

security create-keychain -p "${keychain_password}" "${keychain_path}"
security set-keychain-settings -lut 21600 "${keychain_path}"
security unlock-keychain -p "${keychain_password}" "${keychain_path}"

existing_keychains="$(security list-keychains -d user | sed 's/[ \"]//g' | tr '\n' ' ')"
security list-keychains -d user -s "${keychain_path}" ${existing_keychains}
security default-keychain -d user -s "${keychain_path}"

security import "${cert_path}" -k "${keychain_path}" -P "${CSC_KEY_PASSWORD}" -T /usr/bin/codesign -T /usr/bin/security
security set-key-partition-list -S apple-tool:,apple: -s -k "${keychain_password}" "${keychain_path}"

identity_full="$(security find-identity -v -p codesigning "${keychain_path}" | awk -F\" '/Developer ID Application:/{print $2; exit}')"
if [[ -z "${identity_full}" ]]; then
  echo "No Developer ID Application identity found in imported signing certificate." >&2
  exit 1
fi

identity_common="${identity_full#Developer ID Application: }"
{
  echo "export COZEA_CODESIGN_IDENTITY=${identity_full@Q}"
  echo "export CSC_NAME=${identity_common@Q}"
  echo "export COZEA_CI_KEYCHAIN=${keychain_path@Q}"
} >> "${BASH_ENV:-/dev/null}"

echo "Imported macOS signing identity: ${identity_full}"
