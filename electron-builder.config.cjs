const fs = require("node:fs")
const path = require("node:path")

const macGitTargets = ["darwin-arm64", "darwin-x64"]
const macGitBinaries = macGitTargets
  .map((target) => {
    const sourcePath = path.join(__dirname, "build", "git", target, "bin", "git")
    const bundlePath = `Contents/Resources/git/${target}/bin/git`
    return { sourcePath, bundlePath }
  })
  .filter(({ sourcePath }) => fs.existsSync(sourcePath))
  .map(({ bundlePath }) => bundlePath)

const macRuntimeTargets = ["darwin-arm64", "darwin-x64"]
const runtimeExecutables = ["node", "npm", "corepack", "pnpm", "yarn", "bun"]
const macRuntimeBinaries = macRuntimeTargets
  .flatMap((target) =>
    runtimeExecutables.map((executable) => {
      const sourcePath = path.join(__dirname, "build", "runtime", target, "bin", executable)
      const bundlePath = `Contents/Resources/runtime/${target}/bin/${executable}`
      return { sourcePath, bundlePath }
    })
  )
  .filter(({ sourcePath }) => fs.existsSync(sourcePath))
  .map(({ bundlePath }) => bundlePath)

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
      from: "build/git",
      to: "git",
      filter: ["**/*"],
    },
    {
      from: "build/runtime",
      to: "runtime",
      // Keep bundled JS toolchain (node/npm/corepack/pnpm/yarn/bun) and metadata,
      // but ship runtime packs (python/rust/go archives) via release assets.
      filter: ["**/*", "!packs/**/*", "!packs-src/**/*"],
    },
  ],
  mac: {
    category: "public.app-category.developer-tools",
    icon: "build/icon.icns",
    hardenedRuntime: true,
    entitlements: "build/entitlements.mac.plist",
    entitlementsInherit: "build/entitlements.mac.plist",
    binaries: [...macGitBinaries, ...macRuntimeBinaries],
    target: ["dmg", "zip"],
  },
  dmg: {
    // Automatic DMG sizing can under-estimate large/sparse app bundles on x64,
    // which leads to truncated app contents and notarization failures.
    size: "4g",
  },
  win: {
    icon: "build/icon.ico",
    target: [
      {
        target: "nsis",
        arch: ["x64"],
      },
    ],
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
