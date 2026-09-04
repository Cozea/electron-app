import { createHash } from "node:crypto"
import fs from "node:fs"
import path from "node:path"

import type {
  DevAppDevelopmentSource,
  DevAppPackageInspection,
  DevAppScaffoldStarter,
} from "../../../../shared/devAppAuthoringTypes"
import {
  NATIVE_DEV_APP_API_VERSION,
  NATIVE_DEV_APP_MANIFEST_FILENAME,
  NATIVE_DEV_APP_MANIFEST_JSON_SCHEMA,
  NATIVE_DEV_APP_MANIFEST_VERSION,
  parseNativeDevAppManifest,
  type NativeDevAppManifestV3,
} from "../../../../shared/nativeDevAppManifest"
import { DEV_APP_WORKER_PROTOCOL_VERSION } from "../../../../shared/devAppWorkerProtocol"
import { formatDevAppRef } from "../../../../shared/devAppRef"
import {
  prepareScaffoldedDevAppProject,
  type DevAppScaffoldPreparation,
  type ScaffoldCommandRunner,
} from "./devAppScaffoldPreparation"

interface InspectOptions {
  projectId: string
  workspaceId: string
  workspaceRoot: string
  relativePath?: string
}

interface ScaffoldOptions extends InspectOptions {
  name: string
  starter: DevAppScaffoldStarter
}

function sourceIdFor(workspaceId: string, relativePath: string): string {
  return createHash("sha256").update(`${workspaceId}\0${relativePath}`).digest("hex").slice(0, 32)
}

function normalizedPackagePath(relativePath = "."): string {
  const normalized = relativePath
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "")
    .replace(/\/+$/, "")
  return normalized || "."
}

function resolvePackageRoot(workspaceRoot: string, relativePath: string): string {
  const root = fs.realpathSync.native(workspaceRoot)
  const candidate = path.resolve(root, relativePath)
  if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) {
    throw new Error("The DevApp package must stay inside its workspace.")
  }
  let resolvedCandidate = candidate
  try {
    resolvedCandidate = fs.realpathSync.native(candidate)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
  }
  if (resolvedCandidate !== root && !resolvedCandidate.startsWith(`${root}${path.sep}`)) {
    throw new Error("The DevApp package must stay inside its workspace.")
  }
  return resolvedCandidate
}

function missingInspection(): DevAppPackageInspection {
  return {
    status: "missing",
    diagnostics: [
      {
        code: "manifest-unparsable",
        severity: "blocker",
        message: `${NATIVE_DEV_APP_MANIFEST_FILENAME} is missing.`,
        fix: "Create a native React DevApp or add a version 3 manifest at the project root.",
      },
    ],
  }
}

function slugify(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "devapp"
  )
}

export class DevAppAuthoringService {
  private readonly runScaffoldCommand: ScaffoldCommandRunner | undefined

  constructor(runScaffoldCommand?: ScaffoldCommandRunner) {
    this.runScaffoldCommand = runScaffoldCommand
  }

  inspect(options: InspectOptions): DevAppPackageInspection {
    const relativePath = normalizedPackagePath(options.relativePath)
    const packageRoot = resolvePackageRoot(options.workspaceRoot, relativePath)
    const manifestPath = path.join(packageRoot, NATIVE_DEV_APP_MANIFEST_FILENAME)
    if (!fs.existsSync(manifestPath)) return missingInspection()

    let raw: string
    try {
      raw = fs.readFileSync(manifestPath, "utf8")
    } catch {
      return {
        status: "invalid",
        diagnostics: [
          {
            code: "manifest-unparsable",
            severity: "blocker",
            message: `${NATIVE_DEV_APP_MANIFEST_FILENAME} could not be read.`,
          },
        ],
      }
    }

    const parsed = parseNativeDevAppManifest(raw)
    if (!parsed.manifest) return { status: "invalid", diagnostics: parsed.diagnostics }
    const sourceId = sourceIdFor(options.workspaceId, relativePath)
    return {
      status: "valid",
      diagnostics: parsed.diagnostics,
      source: {
        sourceId,
        ref: formatDevAppRef({ kind: "development", sourceId }),
        projectId: options.projectId,
        workspaceId: options.workspaceId,
        relativePath,
        name: parsed.manifest.name,
        description: parsed.manifest.description ?? null,
        manifest: parsed.manifest,
      },
    }
  }

  inspectFolder(folderPath: string): DevAppPackageInspection {
    const root = fs.realpathSync.native(folderPath)
    const sourceId = sourceIdFor(`import:${root}`, ".")
    return this.inspect({ projectId: "pending", workspaceId: sourceId, workspaceRoot: root })
  }

  scaffold(options: ScaffoldOptions): {
    source: DevAppDevelopmentSource
    createdFiles: string[]
    preparation: DevAppScaffoldPreparation
  } {
    const trimmedName = options.name.trim()
    if (!trimmedName || trimmedName.length > 120) throw new Error("Choose a DevApp name.")
    const relativePath = normalizedPackagePath(options.relativePath)
    const packageRoot = resolvePackageRoot(options.workspaceRoot, relativePath)
    fs.mkdirSync(packageRoot, { recursive: true })

    const files = scaffoldFiles(trimmedName, options.starter)
    const conflicts = Object.keys(files).filter((relative) =>
      fs.existsSync(path.join(packageRoot, relative)),
    )
    if (conflicts.length > 0) {
      throw new Error(`The DevApp scaffold would replace existing files: ${conflicts.join(", ")}`)
    }

    const createdFiles: string[] = []
    try {
      for (const [relative, content] of Object.entries(files)) {
        const target = path.join(packageRoot, relative)
        fs.mkdirSync(path.dirname(target), { recursive: true })
        fs.writeFileSync(target, content, { encoding: "utf8", flag: "wx" })
        createdFiles.push(relative)
      }
    } catch (error) {
      for (const relative of createdFiles.reverse()) {
        try {
          fs.unlinkSync(path.join(packageRoot, relative))
        } catch {
          // Best-effort rollback.
        }
      }
      throw error
    }

    const inspection = this.inspect({ ...options, relativePath })
    if (inspection.status !== "valid") {
      throw new Error("The generated native DevApp manifest failed validation.")
    }
    const preparation = prepareScaffoldedDevAppProject(packageRoot, this.runScaffoldCommand)
    return { source: inspection.source, createdFiles, preparation }
  }
}

function scaffoldFiles(name: string, starter: DevAppScaffoldStarter): Record<string, string> {
  const slug = slugify(name)
  const hasExtension = starter === "worker" || starter === "view-worker"
  const manifest: NativeDevAppManifestV3 = {
    manifestVersion: NATIVE_DEV_APP_MANIFEST_VERSION,
    id: `local.${slug}`,
    name,
    version: "0.1.0",
    description: `${name} is a native React extension rendered directly inside Cozea.`,
    engines: {
      cozea: ">=0.3.0 <0.4.0",
      nativeApi: NATIVE_DEV_APP_API_VERSION,
    },
    rendererModules: {
      main: {
        entry: "src/renderer.tsx",
        output: "dist/renderer.mjs",
        styles: {
          entry: "src/styles.css",
          output: "dist/renderer.css",
        },
      },
    },
    ...(hasExtension
      ? {
          extension: {
            entry: "src/extension.ts",
            output: "dist/extension.mjs",
            protocolVersion: DEV_APP_WORKER_PROTOCOL_VERSION,
            capabilities: ["project.metadata", "project.read"],
            tools: [],
          },
        }
      : {}),
    contributes: {
      surfaces: [
        {
          id: "main",
          title: name,
          default: true,
          renderer: {
            kind: "native-react",
            module: "main",
            component: "MainSurface",
          },
          placement: {
            group: hasExtension ? "Assistant" : "Development",
            minimumWidth: 320,
            minimumHeight: 240,
          },
        },
      ],
    },
  }

  const files: Record<string, string> = {
    [NATIVE_DEV_APP_MANIFEST_FILENAME]: `${JSON.stringify(manifest, null, 2)}\n`,
    ".cozea/cozea-native-devapp.schema.json": `${JSON.stringify(
      NATIVE_DEV_APP_MANIFEST_JSON_SCHEMA,
      null,
      2,
    )}\n`,
    ".vscode/settings.json": `${JSON.stringify(
      {
        "json.schemas": [
          {
            fileMatch: [NATIVE_DEV_APP_MANIFEST_FILENAME],
            url: "./.cozea/cozea-native-devapp.schema.json",
          },
        ],
      },
      null,
      2,
    )}\n`,
    "package.json": `${JSON.stringify(
      {
        name: slug,
        private: true,
        type: "module",
        scripts: {
          validate: "cozea-devapp validate",
          build: "cozea-devapp build",
          dev: "cozea-devapp dev",
        },
        dependencies: {
          "@cozea/devapp-api": "^0.2.0",
          react: "^19.0.0",
        },
        devDependencies: {
          "@types/react": "^19.0.0",
          typescript: "^5.9.0",
        },
      },
      null,
      2,
    )}\n`,
    "tsconfig.json": `${JSON.stringify(
      {
        compilerOptions: {
          target: "ES2023",
          lib: ["ES2023", "DOM"],
          module: "ESNext",
          moduleResolution: "Bundler",
          strict: true,
          noEmit: true,
          jsx: "react-jsx",
          skipLibCheck: true,
        },
        include: ["src"],
      },
      null,
      2,
    )}\n`,
    "src/renderer.tsx": rendererSource(name),
    "src/styles.css": rendererStyles(),
    // A bootstrap build makes the first preview work even before package installation succeeds.
    "dist/renderer.mjs": bootstrapRenderer(name),
    "dist/renderer.css": rendererStyles(),
    "AGENTS.md": agentInstructions(name, hasExtension),
    "README.md": `# ${name}\n\nA native React Cozea DevApp. Its TSX component is loaded directly into Cozea's renderer; it is not an HTML page or webview.\n\n- \`bun run dev\` watches and rebuilds the native ESM module.\n- \`bun run build\` creates immutable renderer and extension outputs.\n- \`cozea-devapp.json\` declares surfaces, permissions, commands, skills and runtime parts.\n- Privileged work belongs in \`src/extension.ts\`, never in the React component.\n`,
  }

  if (hasExtension) {
    files["src/extension.ts"] = extensionSource()
    files["dist/extension.mjs"] = extensionBootstrap()
  }

  return files
}

function rendererSource(name: string): string {
  return `import { useState } from "react"\nimport {\n  DevAppButton,\n  DevAppEmptyState,\n  DevAppPanel,\n  DevAppToolbar,\n  defineNativeDevApp,\n  useDevAppContext,\n} from "@cozea/devapp-api/native"\n\nexport function MainSurface() {\n  const cozea = useDevAppContext()\n  const [fileCount, setFileCount] = useState<number | null>(null)\n  const [error, setError] = useState<string | null>(null)\n\n  const inspectProject = async () => {\n    setError(null)\n    try {\n      const files = await cozea.project.listFiles()\n      setFileCount(files.length)\n    } catch (cause) {\n      setError(cause instanceof Error ? cause.message : "Could not inspect the project.")\n    }\n  }\n\n  return (\n    <DevAppPanel>\n      <DevAppToolbar title=${JSON.stringify(name)} />\n      <DevAppEmptyState\n        title={fileCount === null ? "Native surface ready" : \`This project has \${fileCount} files\`}\n        description={error ?? "This React component is mounted directly in Cozea and uses a capability-scoped host context."}\n        action={<DevAppButton onClick={() => void inspectProject()}>Inspect project</DevAppButton>}\n      />\n    </DevAppPanel>\n  )\n}\n\nexport default defineNativeDevApp({\n  components: { MainSurface },\n})\n`
}

function rendererStyles(): string {
  return `[data-cozea-native-devapp] {\n  min-width: 0;\n  min-height: 0;\n}\n`
}

function bootstrapRenderer(name: string): string {
  return `const runtime = globalThis[Symbol.for("cozea.nativeDevAppHost.v1")]\nif (!runtime?.react) throw new Error("The Cozea native DevApp host is unavailable.")\nconst React = runtime.react\nconst Context = React.createContext(null)\nfunction Provider({ value, children }) { return React.createElement(Context.Provider, { value }, children) }\nfunction MainSurface() {\n  const cozea = React.useContext(Context)\n  const [fileCount, setFileCount] = React.useState(null)\n  const [error, setError] = React.useState(null)\n  const inspect = async () => {\n    setError(null)\n    try { const files = await cozea.project.listFiles(); setFileCount(files.length) }\n    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not inspect the project.") }\n  }\n  return React.createElement("div", { style: { height: "100%", display: "flex", flexDirection: "column", background: "var(--content-surface, transparent)", color: "var(--foreground)" } },\n    React.createElement("header", { style: { height: 40, display: "flex", alignItems: "center", padding: "0 12px", borderBottom: "1px solid var(--border)" } }, ${JSON.stringify(name)}),\n    React.createElement("main", { style: { flex: 1, minHeight: 0, display: "grid", placeItems: "center", padding: 24, textAlign: "center" } },\n      React.createElement("div", null,\n        React.createElement("h2", { style: { fontSize: 14, fontWeight: 600 } }, fileCount === null ? "Native surface ready" : \`This project has \${fileCount} files\`),\n        React.createElement("p", { style: { fontSize: 12, color: "var(--muted-foreground)", maxWidth: 420 } }, error ?? "This component is mounted directly in Cozea; no HTML document or webview is involved."),\n        React.createElement("button", { type: "button", onClick: inspect, style: { marginTop: 12, borderRadius: 6, padding: "7px 12px", border: "1px solid var(--border)", background: "var(--primary)", color: "var(--primary-foreground)", cursor: "pointer" } }, "Inspect project")\n      )\n    )\n  )\n}\nexport default { apiVersion: 1, components: { MainSurface }, __CozeaContextProvider: Provider }\n`
}

function extensionSource(): string {
  return `import { createDevAppWorker } from "@cozea/devapp-api"\n\ncreateDevAppWorker({\n  ping: async ({ message }: { message?: string }) => ({\n    ok: true,\n    message: message ?? "pong",\n  }),\n})\n`
}

function extensionBootstrap(): string {
  return `import { createDevAppWorker } from "@cozea/devapp-api"\ncreateDevAppWorker({ ping: async ({ message } = {}) => ({ ok: true, message: message ?? "pong" }) })\n`
}

function agentInstructions(name: string, hasExtension: boolean): string {
  return `# ${name}: Cozea native DevApp\n\nThis repository is a **native React Cozea DevApp**. It is not a website.\n\n## Required rules\n\n- Build UI as exported React components in \`src/renderer.tsx\`.\n- Do not create \`index.html\`, a standalone Vite site, iframe or webview.\n- Import host APIs and stable UI primitives from \`@cozea/devapp-api/native\`.\n- Do not import Electron, Node built-ins, Cozea private \`@/\` modules, or \`react-dom\` in renderer code.\n- The renderer has no direct filesystem or process access. Use \`useDevAppContext()\` and declared capabilities.\n- Keep privileged or background work in ${hasExtension ? "`src/extension.ts`" : "an explicitly declared extension module if one is added"}.\n- Keep \`cozea-devapp.json\` authoritative. Surface component names must match exported components.\n- Run \`bun run validate\` after manifest edits and \`bun run build\` before reporting completion.\n- During development, \`bun run dev\` rebuilds the ESM module; Cozea remounts the new generation.\n\n## Package outputs\n\n- Native renderer: \`dist/renderer.mjs\`\n- Scoped styles: \`dist/renderer.css\`\n${hasExtension ? "- Extension worker: `dist/extension.mjs`\n" : ""}- Manifest: \`cozea-devapp.json\`\n\nWeb applications may be adopted later through a \`web-app\` surface adapter, but new Cozea-specific workflows should remain native React components.\n`
}
