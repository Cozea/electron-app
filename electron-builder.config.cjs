const releaseLane = process.env.COZEA_RELEASE_LANE ?? "stable"
const updaterChannel = process.env.COZEA_UPDATER_CHANNEL ?? "latest"
const githubReleaseType =
  process.env.COZEA_GITHUB_RELEASE_TYPE ?? (releaseLane === "stable" ? "release" : "prerelease")
const updateProvider = process.env.COZEA_UPDATE_PROVIDER ?? "github"
const updateBaseUrl = process.env.COZEA_UPDATE_BASE_URL ?? ""

function resolvePublishConfig() {
  if (updateProvider === "generic") {
    if (!updateBaseUrl) {
      throw new Error("COZEA_UPDATE_BASE_URL is required when COZEA_UPDATE_PROVIDER=generic")
    }

    return {
      provider: "generic",
      url: `${updateBaseUrl.replace(/\/+$/, "")}/${updaterChannel}`,
      channel: updaterChannel,
    }
  }

  return {
    provider: "github",
    owner: "Cozea",
    repo: "cozea-prod",
    channel: updaterChannel,
    releaseType: githubReleaseType,
  }
}

/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: "com.cozea.app",
  productName: "Cozea",
  forceCodeSigning: true,
  generateUpdatesFilesForAllChannels: true,
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
    x64ArchFiles:
      "**/node_modules/{@anthropic-ai/claude-agent-sdk/vendor,@cozea/pty,@esbuild/darwin-*,node-pty/prebuilds/darwin-*,@msgpackr-extract/msgpackr-extract-darwin-*,@img/sharp-darwin-*,@img/sharp-libvips-darwin-*,@rollup/rollup-darwin-*,lightningcss-darwin-*,@tailwindcss/oxide-darwin-*,@oxfmt/binding-darwin-*,@oxlint/binding-darwin-*}/**/*",
    ...(process.env.COZEA_SKIP_NOTARIZE === "1" ? { notarize: false } : {}),
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
  publish: resolvePublishConfig(),
}
