const fs = require("node:fs")
const path = require("node:path")

const macGitTargets = ["darwin-arm64", "darwin-x64"]
const macBinaries = macGitTargets
  .map((target) => {
    const sourcePath = path.join(__dirname, "build", "git", target, "bin", "git")
    const bundlePath = `Contents/Resources/git/${target}/bin/git`
    return { sourcePath, bundlePath }
  })
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
  ],
  mac: {
    category: "public.app-category.developer-tools",
    icon: "build/icon.icns",
    binaries: macBinaries,
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
