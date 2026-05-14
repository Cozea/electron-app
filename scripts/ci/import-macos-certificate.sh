#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${CSC_LINK:-}" || -z "${CSC_KEY_PASSWORD:-}" ]]; then
  echo "Missing CSC_LINK or CSC_KEY_PASSWORD for macOS signing." >&2
  exit 1
fi

tmp_dir="$(mktemp -d)"
cert_path="${tmp_dir}/cozea-signing-cert.p12"
cert_pem_path="${tmp_dir}/cozea-signing-cert.pem"
developer_id_ca_path="${tmp_dir}/DeveloperIDG2CA.cer"
apple_root_ca_path="${tmp_dir}/AppleIncRootCertificate.cer"

shell_quote() {
  printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"
}

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

if openssl pkcs12 -in "${cert_path}" -nokeys -passin "pass:${CSC_KEY_PASSWORD}" -out "${cert_pem_path}" >/dev/null 2>&1 ||
  openssl pkcs12 -legacy -in "${cert_path}" -nokeys -passin "pass:${CSC_KEY_PASSWORD}" -out "${cert_pem_path}" >/dev/null 2>&1; then
  echo "Decoded macOS signing certificate:"
  openssl x509 -in "${cert_pem_path}" -noout -subject -issuer -fingerprint -sha1
else
  echo "Unable to inspect certificate payload from CSC_LINK." >&2
fi

keychain_path="${HOME}/Library/Keychains/cozea-ci-signing.keychain-db"
keychain_password="$(openssl rand -hex 16)"

security create-keychain -p "${keychain_password}" "${keychain_path}"
security set-keychain-settings -lut 21600 "${keychain_path}"
security unlock-keychain -p "${keychain_password}" "${keychain_path}"

existing_keychains=()
while IFS= read -r listed_keychain; do
  existing_keychains+=("$(printf '%s' "${listed_keychain}" | sed 's/^[[:space:]]*"\(.*\)"[[:space:]]*$/\1/')")
done < <(security list-keychains -d user)
security list-keychains -d user -s \
  "${keychain_path}" \
  "${existing_keychains[@]}" \
  "/Library/Keychains/System.keychain" \
  "/System/Library/Keychains/SystemRootCertificates.keychain"
security default-keychain -d user -s "${keychain_path}"

curl -fsSL "https://www.apple.com/certificateauthority/DeveloperIDG2CA.cer" -o "${developer_id_ca_path}"
curl -fsSL "https://www.apple.com/appleca/AppleIncRootCertificate.cer" -o "${apple_root_ca_path}"

# Import the intermediate and root into our keychain so codesign can find them
# during chain building. -T flags are a no-op on certs (only keys have ACLs)
# but harmless.
security import "${apple_root_ca_path}" -k "${keychain_path}" || true
security import "${developer_id_ca_path}" -k "${keychain_path}" || true

# Mark both as trusted for code signing in the *user* trust domain (no -d, no
# sudo required). Without trust settings, codesign on macOS Sequoia cannot
# build the chain from the leaf to a self-signed root, which surfaces as
# "unable to build chain to self-signed root" + errSecInternalComponent.
security add-trusted-cert -r trustRoot -p codeSign -k "${keychain_path}" "${apple_root_ca_path}" || true
security add-trusted-cert -r trustAsRoot -p codeSign -k "${keychain_path}" "${developer_id_ca_path}" || true

# Best-effort: also trust the Apple Root in the system keychain if sudo is
# available. Not required when the user-domain trust above succeeds.
if sudo -n true 2>/dev/null; then
  sudo -n security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain "${apple_root_ca_path}" || true
fi
security import "${cert_path}" -k "${keychain_path}" -P "${CSC_KEY_PASSWORD}" -T /usr/bin/codesign -T /usr/bin/security
if [[ -s "${cert_pem_path}" ]]; then
  security import "${cert_pem_path}" -k "${keychain_path}" -T /usr/bin/codesign -T /usr/bin/security || true
  security verify-cert -c "${cert_pem_path}" -c "${developer_id_ca_path}" -p codesigning || true
fi
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "${keychain_password}" "${keychain_path}"

identity_full="$(security find-identity -v -p codesigning "${keychain_path}" | awk -F\" '/Developer ID Application:/{print $2; exit}')"
if [[ -z "${identity_full}" ]]; then
  security find-identity -v -p codesigning "${keychain_path}" || true
  echo "No Developer ID Application identity found in imported signing certificate." >&2
  exit 1
fi

identity_common="${identity_full#Developer ID Application: }"
{
  echo "export COZEA_CODESIGN_IDENTITY=$(shell_quote "${identity_full}")"
  echo "export CSC_NAME=$(shell_quote "${identity_common}")"
  echo "export COZEA_CI_KEYCHAIN=$(shell_quote "${keychain_path}")"
  echo "export COZEA_CI_KEYCHAIN_PASSWORD=$(shell_quote "${keychain_password}")"
  # Keep the signing keychain in the user keychain search list, but do not pass
  # --keychain to every codesign invocation. Passing --keychain can prevent
  # nested vendor binaries from resolving the full Apple trust chain in CI.
  echo "unset CSC_KEYCHAIN"
  # The legacy P12 has already been imported above. Prevent electron-builder from
  # trying to import CSC_LINK again with its non-legacy path.
  echo "unset CSC_LINK"
  echo "unset CSC_KEY_PASSWORD"
} >> "${BASH_ENV:-/dev/null}"

echo "Imported macOS signing identity: ${identity_full}"
