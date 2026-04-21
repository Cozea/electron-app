/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: "com.cozea.app",
  productName: "Cozea",
  forceCodeSigning: true,
  // Pack archive rewriting must happen before app signing/notarization.
  // Running it after notarization invalidates Gatekeeper trust for the final app.
  afterPack: "scripts/electron-builder-after-sign.cjs",
  directories: {
    buildResources: "build",
    output: "dist",
  },
  files: ["out/**/*", "package.json"],
  extraResources: [
    {
      from: "build/runtime",
      to: "runtime",
      // Ship lightweight runtime metadata and verification material only.
      // Actual language/toolchain runtimes should come from the system PATH.
      filter: [
        "capability-catalog.json",
        "capability-catalog.sig",
        "runtime-public-key.pem",
      ],
    },
  ],
  mac: {
    category: "public.app-category.developer-tools",
    icon: "build/icon.icns",
    hardenedRuntime: true,
    entitlements: "build/entitlements.mac.plist",
    entitlementsInherit: "build/entitlements.mac.plist",
    target: ["dmg", "zip"],
  },
  dmg: {
    // Automatic DMG sizing can under-estimate large/sparse app bundles on x64,
    // which leads to truncated app contents and notarization failures.
    size: "4g",
  },
  win: {
    icon: "build/icon.ico",
    target: ["nsis"],
  },
  linux: {
    icon: "build/icon.png",
    target: ["dir"],
  },
  publish: {
    provider: "github",
    owner: "Cozea",
    repo: "cozea-prod",
    releaseType: "release",
  },
}
