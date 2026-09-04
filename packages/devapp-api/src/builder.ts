#!/usr/bin/env bun

import fs from "node:fs"
import path from "node:path"
import process from "node:process"

import {
  NATIVE_DEV_APP_MANIFEST_FILENAME,
  parseNativeDevAppManifest,
  type NativeDevAppManifestV3,
  type NativeDevAppRendererModuleSpec,
} from "./shared/nativeDevAppManifest"

interface BunBuildMessage {
  message?: string
  position?: { file?: string; line?: number; column?: number }
  toString(): string
}

interface BunBuildResult {
  success: boolean
  logs: BunBuildMessage[]
  outputs: Array<{ path: string }>
}

interface BunPluginBuilder {
  onResolve(
    options: { filter: RegExp; namespace?: string },
    callback: (args: { path: string; importer: string }) =>
      | { path: string; namespace?: string; external?: boolean }
      | null
      | undefined,
  ): void
  onLoad(
    options: { filter: RegExp; namespace?: string },
    callback: (args: { path: string }) =>
      | { contents: string; loader: "js" | "jsx" | "ts" | "tsx" }
      | null
      | undefined,
  ): void
}

interface BunBuildApi {
  build(options: {
    entrypoints: string[]
    outdir: string
    naming?: string
    root?: string
    target: "browser" | "bun"
    format: "esm"
    splitting?: boolean
    sourcemap?: "external" | "inline" | "none"
    minify?: boolean
    packages?: "bundle"
    plugins?: Array<{ name: string; setup(builder: BunPluginBuilder): void }>
  }): Promise<BunBuildResult>
}

const bun = (globalThis as typeof globalThis & { Bun?: BunBuildApi }).Bun
if (!bun) {
  throw new Error("The Cozea DevApp builder must run with Bun.")
}

const HOST_RUNTIME_KEY = "cozea.nativeDevAppHost.v1"
const FORBIDDEN_RENDERER_IMPORT = /^(?:electron|node:|react-dom(?:\/.*)?|@\/|@shared\/|@cozea\/internal(?:\/.*)?)$/

const REACT_PROXY = `
const runtime = globalThis[Symbol.for(${JSON.stringify(HOST_RUNTIME_KEY)})]
if (!runtime?.react) throw new Error("The Cozea native React host is unavailable.")
const React = runtime.react
export default React
export const Activity = React.Activity
export const Children = React.Children
export const Component = React.Component
export const Fragment = React.Fragment
export const Profiler = React.Profiler
export const PureComponent = React.PureComponent
export const StrictMode = React.StrictMode
export const Suspense = React.Suspense
export const cloneElement = React.cloneElement
export const createContext = React.createContext
export const createElement = React.createElement
export const createRef = React.createRef
export const forwardRef = React.forwardRef
export const isValidElement = React.isValidElement
export const lazy = React.lazy
export const memo = React.memo
export const startTransition = React.startTransition
export const use = React.use
export const useActionState = React.useActionState
export const useCallback = React.useCallback
export const useContext = React.useContext
export const useDebugValue = React.useDebugValue
export const useDeferredValue = React.useDeferredValue
export const useEffect = React.useEffect
export const useEffectEvent = React.useEffectEvent
export const useId = React.useId
export const useImperativeHandle = React.useImperativeHandle
export const useInsertionEffect = React.useInsertionEffect
export const useLayoutEffect = React.useLayoutEffect
export const useMemo = React.useMemo
export const useOptimistic = React.useOptimistic
export const useReducer = React.useReducer
export const useRef = React.useRef
export const useState = React.useState
export const useSyncExternalStore = React.useSyncExternalStore
export const useTransition = React.useTransition
export const version = React.version
`

const JSX_RUNTIME_PROXY = `
const runtime = globalThis[Symbol.for(${JSON.stringify(HOST_RUNTIME_KEY)})]
if (!runtime?.jsxRuntime) throw new Error("The Cozea JSX host is unavailable.")
export const Fragment = runtime.jsxRuntime.Fragment
export const jsx = runtime.jsxRuntime.jsx
export const jsxs = runtime.jsxRuntime.jsxs
`

const JSX_DEV_RUNTIME_PROXY = `
const runtime = globalThis[Symbol.for(${JSON.stringify(HOST_RUNTIME_KEY)})]
if (!runtime?.jsxDevRuntime) throw new Error("The Cozea JSX development host is unavailable.")
export const Fragment = runtime.jsxDevRuntime.Fragment
export const jsxDEV = runtime.jsxDevRuntime.jsxDEV
`

function nativeRendererPlugin() {
  return {
    name: "cozea-native-react-runtime",
    setup(builder: BunPluginBuilder) {
      builder.onResolve({ filter: /^react$/ }, () => ({
        path: "react",
        namespace: "cozea-host-runtime",
      }))
      builder.onResolve({ filter: /^react\/jsx-runtime$/ }, () => ({
        path: "react/jsx-runtime",
        namespace: "cozea-host-runtime",
      }))
      builder.onResolve({ filter: /^react\/jsx-dev-runtime$/ }, () => ({
        path: "react/jsx-dev-runtime",
        namespace: "cozea-host-runtime",
      }))
      builder.onResolve({ filter: FORBIDDEN_RENDERER_IMPORT }, (args) => {
        throw new Error(
          `Native DevApp renderer code cannot import ${args.path}. Use @cozea/devapp-api/native and the capability context instead.`,
        )
      })
      builder.onLoad({ filter: /.*/, namespace: "cozea-host-runtime" }, (args) => ({
        contents:
          args.path === "react"
            ? REACT_PROXY
            : args.path === "react/jsx-dev-runtime"
              ? JSX_DEV_RUNTIME_PROXY
              : JSX_RUNTIME_PROXY,
        loader: "js",
      }))
    },
  }
}

function readManifest(projectRoot: string): NativeDevAppManifestV3 {
  const manifestPath = path.join(projectRoot, NATIVE_DEV_APP_MANIFEST_FILENAME)
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`${NATIVE_DEV_APP_MANIFEST_FILENAME} is missing from ${projectRoot}.`)
  }
  const result = parseNativeDevAppManifest(fs.readFileSync(manifestPath, "utf8"))
  if (!result.manifest) {
    throw new Error(result.diagnostics.map((entry) => entry.message).join("\n"))
  }
  return result.manifest
}

function formatLog(log: BunBuildMessage): string {
  const file = log.position?.file
  const line = log.position?.line
  const column = log.position?.column
  const location = file ? `${file}${line ? `:${line}${column ? `:${column}` : ""}` : ""}` : ""
  return `${location ? `${location} ` : ""}${log.message ?? String(log)}`.trim()
}

async function buildEntry(options: {
  projectRoot: string
  source: string
  output: string
  target: "browser" | "bun"
  nativeRenderer?: boolean
}): Promise<void> {
  const sourcePath = path.resolve(options.projectRoot, options.source)
  const outputPath = path.resolve(options.projectRoot, options.output)
  if (!sourcePath.startsWith(`${options.projectRoot}${path.sep}`) || !outputPath.startsWith(`${options.projectRoot}${path.sep}`)) {
    throw new Error("A DevApp build entry escaped the project root.")
  }
  if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
    throw new Error(`${options.source} does not exist.`)
  }
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  const result = await bun.build({
    entrypoints: [sourcePath],
    root: options.projectRoot,
    outdir: path.dirname(outputPath),
    naming: path.basename(outputPath),
    target: options.target,
    format: "esm",
    splitting: false,
    sourcemap: "external",
    minify: false,
    packages: "bundle",
    ...(options.nativeRenderer ? { plugins: [nativeRendererPlugin()] } : {}),
  })
  if (!result.success) {
    throw new Error(result.logs.map(formatLog).join("\n") || `Could not build ${options.source}.`)
  }
  if (!fs.existsSync(outputPath)) {
    const emitted = result.outputs.find((entry) => entry.path.endsWith(path.basename(outputPath)))
    if (emitted && fs.existsSync(emitted.path)) fs.renameSync(emitted.path, outputPath)
  }
  if (!fs.existsSync(outputPath)) {
    throw new Error(`The builder did not emit ${options.output}.`)
  }
}

function copyStyles(projectRoot: string, module: NativeDevAppRendererModuleSpec): void {
  if (!module.styles) return
  const source = path.resolve(projectRoot, module.styles.entry)
  const output = path.resolve(projectRoot, module.styles.output)
  if (!source.startsWith(`${projectRoot}${path.sep}`) || !output.startsWith(`${projectRoot}${path.sep}`)) {
    throw new Error("A DevApp style entry escaped the project root.")
  }
  if (!fs.existsSync(source) || !fs.statSync(source).isFile()) {
    throw new Error(`${module.styles.entry} does not exist.`)
  }
  fs.mkdirSync(path.dirname(output), { recursive: true })
  fs.copyFileSync(source, output)
}

export async function buildNativeDevApp(projectRootInput = process.cwd()): Promise<NativeDevAppManifestV3> {
  const projectRoot = fs.realpathSync.native(projectRootInput)
  const manifest = readManifest(projectRoot)
  for (const module of Object.values(manifest.rendererModules ?? {})) {
    await buildEntry({
      projectRoot,
      source: module.entry,
      output: module.output,
      target: "browser",
      nativeRenderer: true,
    })
    copyStyles(projectRoot, module)
  }
  if (manifest.extension) {
    await buildEntry({
      projectRoot,
      source: manifest.extension.entry,
      output: manifest.extension.output,
      target: "bun",
    })
  }
  const metadataPath = path.join(projectRoot, "dist", "cozea-native-build.json")
  fs.mkdirSync(path.dirname(metadataPath), { recursive: true })
  fs.writeFileSync(
    metadataPath,
    `${JSON.stringify(
      {
        manifestVersion: manifest.manifestVersion,
        appId: manifest.id,
        appVersion: manifest.version,
        nativeApi: manifest.engines.nativeApi,
        builtAt: new Date().toISOString(),
        rendererModules: Object.fromEntries(
          Object.entries(manifest.rendererModules ?? {}).map(([id, module]) => [
            id,
            { output: module.output, styles: module.styles?.output ?? null },
          ]),
        ),
        extension: manifest.extension?.output ?? null,
      },
      null,
      2,
    )}\n`,
    "utf8",
  )
  return manifest
}

function printDiagnostics(projectRoot: string): NativeDevAppManifestV3 {
  const manifest = readManifest(projectRoot)
  process.stdout.write(
    `${manifest.name} ${manifest.version}: ${manifest.contributes.surfaces.length} surface(s), ${Object.keys(manifest.rendererModules ?? {}).length} native renderer module(s).\n`,
  )
  return manifest
}

async function watch(projectRoot: string): Promise<void> {
  let building = false
  let pending = false
  const run = async () => {
    if (building) {
      pending = true
      return
    }
    building = true
    try {
      await buildNativeDevApp(projectRoot)
      process.stdout.write(`[cozea-devapp] built ${new Date().toLocaleTimeString()}\n`)
    } catch (error) {
      process.stderr.write(`[cozea-devapp] ${error instanceof Error ? error.message : String(error)}\n`)
    } finally {
      building = false
      if (pending) {
        pending = false
        void run()
      }
    }
  }
  await run()
  let timer: ReturnType<typeof setTimeout> | null = null
  fs.watch(projectRoot, { recursive: true }, (_event, filename) => {
    const normalized = String(filename ?? "").replace(/\\/g, "/")
    if (!normalized || normalized.startsWith("dist/") || normalized.includes("/node_modules/")) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => void run(), 100)
  })
  process.stdout.write("[cozea-devapp] watching for native renderer changes…\n")
  await new Promise<void>(() => undefined)
}

async function main(): Promise<void> {
  const [command = "build", rootArgument] = process.argv.slice(2)
  const projectRoot = fs.realpathSync.native(rootArgument ? path.resolve(rootArgument) : process.cwd())
  if (command === "validate") {
    printDiagnostics(projectRoot)
    return
  }
  if (command === "build") {
    const manifest = await buildNativeDevApp(projectRoot)
    process.stdout.write(`Built ${manifest.name} ${manifest.version}.\n`)
    return
  }
  if (command === "dev") {
    await watch(projectRoot)
    return
  }
  throw new Error(`Unknown command ${command}. Use validate, build, or dev.`)
}

if (import.meta.main) {
  void main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
