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
      filter: ["**/*", "!packs-src/**/*"],
    },
  ],
  mac: {
    category: "public.app-category.developer-tools",
    icon: "build/icon.icns",
    binaries: [...macGitBinaries, ...macRuntimeBinaries],
    target: ["dmg", "zip"],
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
