const releaseLane = process.env.COZEA_RELEASE_LANE ?? "stable"
const updaterChannel = process.env.COZEA_UPDATER_CHANNEL ?? "latest"
const githubReleaseType =
  process.env.COZEA_GITHUB_RELEASE_TYPE ?? (releaseLane === "stable" ? "release" : "prerelease")
const updateProvider = process.env.COZEA_UPDATE_PROVIDER ?? "github"
const updateBaseUrl = process.env.COZEA_UPDATE_BASE_URL ?? ""
const macUniversalX64ArchFilePackages = [
  // Claude SDK 0.3 platform binaries are excluded via `files` below — we spawn
  // the user's PATH `claude` via pathToClaudeCodeExecutable, so leave them out.
  "@cozea/pty",
  "@esbuild/darwin-*",
  "@img/sharp-darwin-*",
  "@img/sharp-libvips-darwin-*",
  "@msgpackr-extract/msgpackr-extract-darwin-*",
  "@oxfmt/binding-darwin-*",
  "@oxlint/binding-darwin-*",
  "@railway/cli",
  "@rollup/rollup-darwin-*",
  "@tailwindcss/oxide-darwin-*",
  "7zip-bin/mac/x64",
  "esbuild",
  "lightningcss-darwin-*",
  "msgpackr-extract/build/Release",
  "node-pty/build/Release",
  "node-pty/prebuilds/darwin-*",
  "playwright/node_modules/fsevents",
]
const macUniversalX64ArchFiles = `**/node_modules/{${macUniversalX64ArchFilePackages.join(",")}}/**/*`

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
  // Release builds must be signed. `dist:local` opts into an unsigned package
  // explicitly so a developer without the release certificate can still smoke
  // the assembled application bundle.
  forceCodeSigning: process.env.COZEA_LOCAL_UNSIGNED_DIST !== "1",
  generateUpdatesFilesForAllChannels: true,
  // Pack archive rewriting must happen before app signing/notarization.
  // Running it after notarization invalidates Gatekeeper trust for the final app.
  afterPack: "../../scripts/electron-builder-after-sign.cjs",
  directories: {
    buildResources: "../../build",
    output: "../../dist",
  },
  // Keep the JS SDK (`@anthropic-ai/claude-agent-sdk`) but drop the unused
  // per-platform native CLI binaries (~230 MB on darwin-arm64). Cozea always
  // passes pathToClaudeCodeExecutable (default: `claude` from PATH).
  files: [
    "out/**/*",
    "package.json",
    "!**/node_modules/@anthropic-ai/claude-agent-sdk-*/**",
  ],
  extraResources: [
    {
      // Portable T3 server bundle plus its production-only native dependencies.
      // `predist` creates this directory and launch fails before packaging if it
      // is absent or cannot be executed.
      from: "../../build/t3-runtime",
      to: "t3-runtime",
      filter: ["**/*", "!node_modules{,/**/*}"],
    },
    {
      // Copy from inside the generated dependency directory so the resource
      // matcher does not apply electron-builder's global node_modules ignore
      // to the portable server payload.
      from: "../../build/t3-runtime/node_modules",
      to: "t3-runtime/node_modules",
      filter: ["**/*"],
    },
    {
      from: "../../build/runtime",
      to: "runtime",
      // Ship lightweight runtime metadata and verification material only.
      // Actual language/toolchain runtimes should come from the system PATH.
      filter: [
        "capability-catalog.json",
        "capability-catalog.sig",
        "runtime-public-key.pem",
      ],
    },
    {
      from: "../../build/local-automation",
      to: "local-automation",
      filter: [
        "cozea-local-automation-helper",
        "DevCommandRanker.mlmodel",
      ],
    },
    {
      // App-owned Apple Containerization helper and its pinned Linux boot resources.
      // `predist` verifies every upstream digest before this directory exists.
      from: "../../build/devapp-container-runtime",
      to: "devapp-container-runtime",
      filter: [
        "cozea-devapp-container-runtime",
        "vmlinux",
        "resource-manifest.json",
      ],
    },
  ],
  mac: {
    category: "public.app-category.developer-tools",
    icon: "../../build/icon.icns",
    hardenedRuntime: true,
    entitlements: "../../build/entitlements.mac.plist",
    entitlementsInherit: "../../build/entitlements.mac.plist",
    x64ArchFiles: macUniversalX64ArchFiles,
    // electron-builder reports "skipped macOS application code signing" as a build
    // failure when it cannot find an identity, so an unsigned build has to opt out
    // by name: CSC_IDENTITY_AUTO_DISCOVERY=false on its own fails the build rather
    // than producing an unsigned bundle. Notarization is moot without a signature.
    ...(process.env.COZEA_MAC_SIGNING === "0" ? { identity: null, notarize: false } : {}),
    ...(process.env.COZEA_SKIP_NOTARIZE === "1" ? { notarize: false } : {}),
    target: ["dmg", "zip"],
  },
  dmg: {
    // Automatic DMG sizing can under-estimate large/sparse app bundles on x64,
    // which leads to truncated app contents and notarization failures.
    size: "4g",
  },
  win: {
    icon: "../../build/icon.ico",
    target: ["nsis"],
  },
  linux: {
    icon: "../../build/icon.png",
    target: ["dir"],
  },
  publish: resolvePublishConfig(),
}
