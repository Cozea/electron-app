#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
[[ "$(uname -s)" == Darwin ]] || { echo 'The fixture requires macOS.' >&2; exit 1; }
package="$PWD/native/computer-use-runtime"
xcrun swift build --package-path "$package" --product computer-use-fixture
bin="$(xcrun swift build --package-path "$package" --show-bin-path)"
bundle="$PWD/build/Cozea CU Fixture.app"
mkdir -p "$bundle/Contents/MacOS"
cp "$bin/computer-use-fixture" "$bundle/Contents/MacOS/computer-use-fixture"
cat > "$bundle/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>CFBundleIdentifier</key><string>com.cozea.computeruse.fixture</string><key>CFBundleName</key><string>Cozea CU Fixture</string><key>CFBundleExecutable</key><string>computer-use-fixture</string><key>CFBundlePackageType</key><string>APPL</string><key>LSMinimumSystemVersion</key><string>14.0</string><key>NSPrincipalClass</key><string>NSApplication</string></dict></plist>
PLIST
codesign --force --sign - "$bundle"
open -n "$bundle"
