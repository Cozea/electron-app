import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import type {
  DevAppDevelopmentSource,
  DevAppPackageInspection,
  DevAppScaffoldStarter,
} from "../../../../shared/devAppAuthoringTypes";
import {
  DEV_APP_MANIFEST_FILENAME,
  DEV_APP_MANIFEST_VERSION,
  DEV_APP_PACKAGE_JSON_SCHEMA,
  parseDevAppPackage,
} from "../../../../shared/devAppPackage";
import { DEV_APP_WORKER_PROTOCOL_VERSION } from "../../../../shared/devAppWorkerProtocol";
import { formatDevAppRef } from "../../../../shared/devAppRef";
import {
  prepareScaffoldedDevAppProject,
  type DevAppScaffoldPreparation,
  type ScaffoldCommandRunner,
} from "./devAppScaffoldPreparation";

interface InspectOptions {
  projectId: string;
  workspaceId: string;
  workspaceRoot: string;
  relativePath?: string;
}

interface ScaffoldOptions extends InspectOptions {
  name: string;
  starter: DevAppScaffoldStarter;
}

function sourceIdFor(workspaceId: string, relativePath: string): string {
  return createHash("sha256").update(`${workspaceId}\0${relativePath}`).digest("hex").slice(0, 32);
}

function normalizedPackagePath(relativePath = "."): string {
  const normalized = relativePath
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "")
    .replace(/\/+$/, "");
  return normalized || ".";
}

function resolvePackageRoot(workspaceRoot: string, relativePath: string): string {
  const root = fs.realpathSync.native(workspaceRoot);
  const candidate = path.resolve(root, relativePath);
  if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) {
    throw new Error("The DevApp package must stay inside its workspace.");
  }

  // Lexical confinement is insufficient when a package directory is a symlink.
  // Resolve existing paths before reading or writing so an in-workspace link cannot
  // turn authoring inspection into an out-of-workspace filesystem capability.
  let resolvedCandidate = candidate;
  try {
    resolvedCandidate = fs.realpathSync.native(candidate);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (resolvedCandidate !== root && !resolvedCandidate.startsWith(`${root}${path.sep}`)) {
    throw new Error("The DevApp package must stay inside its workspace.");
  }
  return resolvedCandidate;
}

function missingInspection(): DevAppPackageInspection {
  return {
    status: "missing",
    diagnostics: [
      {
        code: "manifest-missing",
        severity: "blocker",
        message: `${DEV_APP_MANIFEST_FILENAME} is missing.`,
        fix: "Create a native DevApp project or add the manifest at the project root.",
      },
    ],
  };
}

export class DevAppAuthoringService {
  private readonly runScaffoldCommand: ScaffoldCommandRunner | undefined;

  constructor(runScaffoldCommand?: ScaffoldCommandRunner) {
    this.runScaffoldCommand = runScaffoldCommand;
  }

  inspect(options: InspectOptions): DevAppPackageInspection {
    const relativePath = normalizedPackagePath(options.relativePath);
    const packageRoot = resolvePackageRoot(options.workspaceRoot, relativePath);
    const manifestPath = path.join(packageRoot, DEV_APP_MANIFEST_FILENAME);
    if (!fs.existsSync(manifestPath)) return missingInspection();

    let raw: string;
    try {
      raw = fs.readFileSync(manifestPath, "utf8");
    } catch {
      return {
        status: "invalid",
        diagnostics: [
          {
            code: "manifest-unparsable",
            severity: "blocker",
            message: `${DEV_APP_MANIFEST_FILENAME} is not valid JSON.`,
            fix: "Fix the JSON syntax and try again.",
          },
        ],
      };
    }

    const parsed = parseDevAppPackage(raw);
    if (!parsed.manifest) return { status: "invalid", diagnostics: parsed.diagnostics };
    const sourceId = sourceIdFor(options.workspaceId, relativePath);
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
    };
  }

  inspectFolder(folderPath: string): DevAppPackageInspection {
    const root = fs.realpathSync.native(folderPath);
    const sourceId = sourceIdFor(`import:${root}`, ".");
    return this.inspect({ projectId: "pending", workspaceId: sourceId, workspaceRoot: root });
  }

  scaffold(options: ScaffoldOptions): {
    source: DevAppDevelopmentSource;
    createdFiles: string[];
    preparation: DevAppScaffoldPreparation;
  } {
    const trimmedName = options.name.trim();
    if (!trimmedName || trimmedName.length > 120) throw new Error("Choose a DevApp name.");
    const relativePath = normalizedPackagePath(options.relativePath);
    const packageRoot = resolvePackageRoot(options.workspaceRoot, relativePath);
    fs.mkdirSync(packageRoot, { recursive: true });

    const files = scaffoldFiles(trimmedName, options.starter);
    const conflicts = Object.keys(files).filter((relative) =>
      fs.existsSync(path.join(packageRoot, relative)),
    );
    if (conflicts.length > 0) {
      throw new Error(`The DevApp scaffold would replace existing files: ${conflicts.join(", ")}`);
    }

    const createdFiles: string[] = [];
    try {
      for (const [relative, content] of Object.entries(files)) {
        const target = path.join(packageRoot, relative);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, content, { encoding: "utf8", flag: "wx" });
        createdFiles.push(relative);
      }
    } catch (error) {
      for (const relative of createdFiles.reverse()) {
        try {
          fs.unlinkSync(path.join(packageRoot, relative));
        } catch {
          /* best-effort rollback */
        }
      }
      throw error;
    }

    const inspection = this.inspect({ ...options, relativePath });
    if (inspection.status !== "valid")
      throw new Error("The generated DevApp manifest failed validation.");
    // Publication requires a lockfile and a recorded tree. Producing them here keeps a new
    // package publishable, instead of failing from the publish dialog much later.
    const preparation = prepareScaffoldedDevAppProject(packageRoot, this.runScaffoldCommand);
    return { source: inspection.source, createdFiles, preparation };
  }
}

function scaffoldFiles(name: string, starter: DevAppScaffoldStarter): Record<string, string> {
  const hasView = starter !== "worker";
  const hasWorker = starter !== "view";
  const manifest = {
    manifestVersion: DEV_APP_MANIFEST_VERSION,
    name,
    description: `${name} is a native Cozea DevApp.`,
    ...(hasView ? { view: { entry: "dist/index.html" } } : {}),
    ...(hasWorker
      ? {
          worker: {
            entry: "worker/index.js",
            protocolVersion: DEV_APP_WORKER_PROTOCOL_VERSION,
            capabilities: ["project.metadata", "project.read"],
            tools: [],
          },
          runtime: { location: "device", state: "device" },
        }
      : {}),
    service: { runtimeKind: "static" },
  };
  const escapedName = name.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      })[character]!,
  );
  const files: Record<string, string> = {
    [DEV_APP_MANIFEST_FILENAME]: `${JSON.stringify(manifest, null, 2)}\n`,
    ".cozea/cozea-devapp.schema.json": `${JSON.stringify(DEV_APP_PACKAGE_JSON_SCHEMA, null, 2)}\n`,
    ".vscode/settings.json": `${JSON.stringify(
      {
        "json.schemas": [
          { fileMatch: [DEV_APP_MANIFEST_FILENAME], url: "./.cozea/cozea-devapp.schema.json" },
        ],
      },
      null,
      2,
    )}\n`,
    "package.json": `${JSON.stringify(
      {
        name:
          name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "") || "cozea-devapp",
        private: true,
        type: "module",
        scripts: { build: "bun run scripts/build.ts", dev: "bun --watch scripts/build.ts" },
        ...(hasWorker ? { dependencies: { "@cozea/devapp-api": "^0.1.0" } } : {}),
      },
      null,
      2,
    )}\n`,
    "scripts/build.ts": hasView
      ? `import { cp, mkdir } from "node:fs/promises"\n\nawait mkdir("dist", { recursive: true })\nawait cp("src/index.html", "dist/index.html")\nawait cp("src/styles.css", "dist/styles.css")\nconsole.log("Built ${name}")\n`
      : `console.log("${name} is a worker-only DevApp; its plain JavaScript worker needs no view build.")\n`,
    "README.md": `# ${name}\n\nA native Cozea DevApp. Open this project in Cozea to preview it, or add its development tile to another project for integration testing.\n\n- \`bun run build\` refreshes the built view.\n- \`cozea-devapp.json\` declares the view, worker, requested capabilities, runtime placement, and state ownership.\n- Development workers are trusted local code and may use their approved project capabilities. Published executable parts run only inside Cozea's contained runtime.\n`,
  };
  if (hasView) {
    files["src/index.html"] =
      `<!doctype html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8" />\n  <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n  <title>${escapedName}</title>\n  <link rel="stylesheet" href="./styles.css" />\n</head>\n<body>\n  <main>\n    <span class="eyebrow">COZEA DEVAPP</span>\n    <h1>${escapedName}</h1>\n    <p>Your native development surface is ready.</p>\n  </main>\n</body>\n</html>\n`;
    files["src/styles.css"] =
      `:root { color-scheme: light dark; font-family: Inter, system-ui, sans-serif; }\n* { box-sizing: border-box; }\nbody { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #151515; color: #f5f5f5; }\nmain { width: min(680px, calc(100vw - 48px)); }\n.eyebrow { color: #7dd3fc; font-size: 12px; font-weight: 700; letter-spacing: .18em; }\nh1 { margin: 18px 0 10px; font-size: clamp(44px, 10vw, 92px); line-height: .94; letter-spacing: -.06em; }\np { color: #aaa; font-size: 18px; }\n`;
    files["dist/index.html"] = files["src/index.html"];
    files["dist/styles.css"] = files["src/styles.css"];
  }
  if (hasWorker) {
    files["worker/index.js"] =
      `import { createDevAppWorker } from "@cozea/devapp-api"\n\n// This same worker runs as powerful, approval-gated local development code and inside\n// Cozea's contained runtime after publication. The SDK selects the correct transport.\ncreateDevAppWorker({\n  ping: async ({ message }) => ({ ok: true, method: "ping", message }),\n})\n`;
    files["src/cozea-devapp.ts"] =
      `import { createDevAppClient, type DevAppMethodDefinition } from "@cozea/devapp-api"\n\ninterface Methods {\n  ping: DevAppMethodDefinition<{ message: string }, { ok: boolean; method: string; message: string }>\n}\n\nexport const worker = createDevAppClient<Methods>()\n`;
  }
  return files;
}
