import { createHash } from "node:crypto"
import fs from "node:fs"
import path from "node:path"

import { canonicalDevAppRuntimeJson, DEV_APP_RUNTIME_BUILD_SOURCE_MAX_BYTES } from "../shared/devAppContainedRuntime"
import { partsForPublishedPackage } from "../shared/devAppParts"
import { DEV_APP_MANIFEST_FILENAME, parseDevAppPackage } from "../shared/devAppPackage"
import { unpackZip } from "../apps/desktop/electron/services/orgDevAppZip"

const BUN_BASE = "oven/bun:1.4.0-debian@sha256:5bb0f9be3a1a36a03e27c9a9dd894a3b1ad26657155c7df4dda771e17bf872ef"

function argument(name: string): string {
  const index = process.argv.indexOf(name)
  const value = index >= 0 ? process.argv[index + 1] : undefined
  if (!value) throw new Error(`Missing ${name}.`)
  return value
}

function digest(value: string | Buffer): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`
}

function shell(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`
}

const sourcePath = path.resolve(argument("--source"))
const contextPath = path.resolve(argument("--context"))
const planPath = path.resolve(argument("--plan"))
const expectedSourceDigest = argument("--source-digest")
const expectedManifestDigest = argument("--package-manifest-digest")
const source = fs.readFileSync(sourcePath)
if (source.byteLength > DEV_APP_RUNTIME_BUILD_SOURCE_MAX_BYTES) {
  throw new Error("The central build source exceeds 128 MB.")
}
if (createHash("sha256").update(source).digest("hex") !== expectedSourceDigest) {
  throw new Error("The central build source digest does not match the authorized job.")
}

fs.rmSync(contextPath, { recursive: true, force: true })
const packagePath = path.join(contextPath, "package")
fs.mkdirSync(packagePath, { recursive: true })
unpackZip(source, packagePath, {
  maxCompressedBytes: DEV_APP_RUNTIME_BUILD_SOURCE_MAX_BYTES,
  maxExpandedBytes: DEV_APP_RUNTIME_BUILD_SOURCE_MAX_BYTES,
  maxEntries: 20_000,
  maxEntryBytes: 32 * 1024 * 1024,
  maxPathBytes: 512,
  maxCompressionRatio: 200,
})
const rawManifest = fs.readFileSync(path.join(packagePath, DEV_APP_MANIFEST_FILENAME), "utf8")
const parsed = parseDevAppPackage(rawManifest)
if (!parsed.manifest) {
  throw new Error(parsed.diagnostics.map((diagnostic) => diagnostic.message).join("\n"))
}
const packageManifestDigest = digest(canonicalDevAppRuntimeJson(parsed.manifest))
if (packageManifestDigest !== expectedManifestDigest) {
  throw new Error("The package manifest does not match the authorized build identity.")
}
if (!parsed.manifest.worker && parsed.manifest.service?.runtimeKind !== "node") {
  throw new Error("The central builder accepts executable DevApps only.")
}
if (!fs.existsSync(path.join(packagePath, "bun.lock"))) {
  throw new Error("The central build requires a committed bun.lock.")
}

const runtimeSource = path.resolve("packages/devapp-runtime/src")
const runtimeDestination = path.join(contextPath, "runtime")
fs.cpSync(runtimeSource, runtimeDestination, { recursive: true, dereference: false })
const executableEntries = [
  parsed.manifest.worker?.entry,
  parsed.manifest.service?.runtimeKind === "node" ? parsed.manifest.service.entry : undefined,
].filter((entry): entry is string => typeof entry === "string")
const validateEntries = executableEntries.map((entry) => `RUN test -f ${shell(`/cozea/package/${entry}`)}\n`).join("")
fs.writeFileSync(
  path.join(contextPath, "Containerfile"),
  `ARG SOURCE_DATE_EPOCH=0\n` +
    `FROM ${BUN_BASE} AS build\n` +
    `ARG SOURCE_DATE_EPOCH\n` +
    `ENV SOURCE_DATE_EPOCH=$SOURCE_DATE_EPOCH\n` +
    `WORKDIR /cozea/package\n` +
    `COPY package/ ./\n` +
    `RUN bun install --frozen-lockfile\n` +
    `RUN --network=none bun run build\n` +
    validateEntries +
    `FROM ${BUN_BASE}\n` +
    `ARG SOURCE_DATE_EPOCH\n` +
    `ENV NODE_ENV=production SOURCE_DATE_EPOCH=$SOURCE_DATE_EPOCH\n` +
    `WORKDIR /cozea/package\n` +
    `COPY --from=build --chown=bun:bun /cozea/package /cozea/package\n` +
    `COPY --chown=bun:bun runtime/ /cozea/runtime/\n` +
    `USER bun\n` +
    `ENTRYPOINT ["bun", "/cozea/runtime/index.ts"]\n`,
  "utf8",
)
const plan = {
  sourceDigest: expectedSourceDigest,
  packageManifestDigest,
  parts: partsForPublishedPackage(parsed.manifest),
  materials: [
    {
      uri: BUN_BASE.slice(0, BUN_BASE.lastIndexOf("@")),
      digest: BUN_BASE.slice(BUN_BASE.lastIndexOf("@") + 1),
    },
    {
      uri: "pkg:bun/bun@1.4.0",
      digest: digest(fs.readFileSync(path.join(packagePath, "bun.lock"))),
    },
  ],
}
fs.mkdirSync(path.dirname(planPath), { recursive: true })
fs.writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8")
