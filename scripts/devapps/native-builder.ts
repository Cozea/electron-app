import { createHash } from "node:crypto";
import { builtinModules } from "node:module";
import {
  cp,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import postcss from "postcss";
import { build as viteBuild, type Plugin } from "vite";

import {
  DEV_APP_RELEASE_MANIFEST_VERSION,
  type DevAppAuthoringManifestV3,
  type DevAppManifestV3Diagnostic,
  type DevAppReleaseManifestV1,
} from "../../shared/devAppManifestV3";
import {
  parseDevAppManifestV3,
  requestedDevAppCapabilitiesV3,
} from "../../shared/devAppManifestV3Parser";
import {
  nativeDevAppRuntimeProxySource,
  nativeDevAppRuntimeVirtualId,
} from "../../shared/nativeDevAppRuntime";

export type NativeDevAppImportClassification = "host-runtime" | "bundled" | "forbidden";

const NODE_IMPORTS = new Set(
  builtinModules.flatMap((moduleId) => {
    const normalized = moduleId.replace(/^node:/, "");
    return [normalized, `node:${normalized}`];
  }),
);
const FORBIDDEN_EXACT_IMPORTS = new Set([
  "electron",
  "react-dom",
  "react-dom/client",
  "react/compiler-runtime",
  "@cozea/devapp-api",
  "@cozea/devapp-api/extension",
]);
const FORBIDDEN_PREFIXES = [
  "react-dom/",
  "@cozea/devapp-api/",
  "@/",
  "@shared/",
  "@cozea/client-runtime",
  "@cozea/contracts",
  "@cozea/effect-acp",
  "@cozea/substrate-",
];
const EXTENSION_SDK_ID = "\0cozea:devapp-extension-sdk";
const ENTRY_PREFIX = "\0cozea:native-entry:";
const PUBLIC_ENTRY_PREFIX = "cozea:native-entry:";
const RELEASE_FILE = "release.json";
const INTEGRITY_FILE = "integrity.json";

export interface NativeDevAppSourceModule {
  id: string;
  entryPath: string;
  stylePath: string | null;
}

export interface NativeDevAppBuildPlan {
  packageRoot: string;
  manifestPath: string;
  outputRoot: string;
  manifest: DevAppAuthoringManifestV3;
  rendererModules: NativeDevAppSourceModule[];
  extensionPath: string | null;
  webSurfaceIds: string[];
}

export interface NativeDevAppBuildResult {
  plan: NativeDevAppBuildPlan;
  release: DevAppReleaseManifestV1;
  releasePath: string;
  integrityPath: string;
}

export class NativeDevAppBuildError extends Error {
  readonly diagnostics: readonly DevAppManifestV3Diagnostic[];

  constructor(message: string, diagnostics: readonly DevAppManifestV3Diagnostic[] = []) {
    super(message);
    this.name = "NativeDevAppBuildError";
    this.diagnostics = diagnostics;
  }
}

export function classifyNativeDevAppImport(
  source: string,
): NativeDevAppImportClassification {
  if (nativeDevAppRuntimeVirtualId(source)) return "host-runtime";
  if (
    NODE_IMPORTS.has(source) ||
    FORBIDDEN_EXACT_IMPORTS.has(source) ||
    FORBIDDEN_PREFIXES.some((prefix) => source.startsWith(prefix))
  ) {
    return "forbidden";
  }
  return "bundled";
}

export function nativeDevAppRuntimeModuleId(source: string): string | null {
  return nativeDevAppRuntimeVirtualId(source);
}

function isInside(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function isNodeModulesPath(candidate: string): boolean {
  return candidate.replaceAll("\\", "/").includes("/node_modules/");
}

async function resolveExistingPackagePath(
  packageRoot: string,
  relativePath: string,
  label: string,
): Promise<string> {
  const candidate = path.resolve(packageRoot, relativePath);
  if (!isInside(packageRoot, candidate)) {
    throw new NativeDevAppBuildError(`${label} escapes the DevApp package.`);
  }
  let resolved: string;
  try {
    resolved = await realpath(candidate);
  } catch {
    throw new NativeDevAppBuildError(`${label} does not exist: ${relativePath}`);
  }
  if (!isInside(packageRoot, resolved)) {
    throw new NativeDevAppBuildError(`${label} resolves outside the DevApp package.`);
  }
  const metadata = await stat(resolved);
  if (!metadata.isFile()) {
    throw new NativeDevAppBuildError(`${label} must be a file: ${relativePath}`);
  }
  return resolved;
}

async function readAuthoringManifest(packageRoot: string): Promise<{
  manifestPath: string;
  manifest: DevAppAuthoringManifestV3;
}> {
  const manifestPath = path.join(packageRoot, "cozea-devapp.json");
  let source: string;
  try {
    source = await readFile(manifestPath, "utf8");
  } catch {
    throw new NativeDevAppBuildError("cozea-devapp.json is missing.");
  }
  const parsed = parseDevAppManifestV3(source);
  if (!parsed.manifest) {
    throw new NativeDevAppBuildError(
      "The DevApp manifest is invalid.",
      parsed.diagnostics,
    );
  }
  return { manifestPath, manifest: parsed.manifest };
}

export async function validateScopedDevAppCss(
  source: string,
  appId: string,
): Promise<string[]> {
  const requiredPrefix = `[data-cozea-devapp="${appId}"]`;
  const violations = new Set<string>();
  let root: ReturnType<typeof postcss.parse>;
  try {
    root = postcss.parse(source);
  } catch (error) {
    return [error instanceof Error ? error.message : "The stylesheet could not be parsed."];
  }
  root.walkRules((rule) => {
    const parent = rule.parent;
    if (
      parent?.type === "atrule" &&
      (parent.name === "keyframes" || parent.name.endsWith("keyframes"))
    ) {
      return;
    }
    for (const selector of rule.selectors) {
      const normalized = selector.trim();
      if (!normalized.startsWith(requiredPrefix)) violations.add(normalized);
    }
  });
  return [...violations].sort();
}

export async function createNativeDevAppBuildPlan(options: {
  packageRoot: string;
  outputRoot?: string;
}): Promise<NativeDevAppBuildPlan> {
  const packageRoot = await realpath(options.packageRoot);
  const { manifestPath, manifest } = await readAuthoringManifest(packageRoot);
  const outputRoot = path.resolve(
    options.outputRoot ?? path.join(packageRoot, ".cozea", "native-build"),
  );
  if (!isInside(packageRoot, outputRoot)) {
    throw new NativeDevAppBuildError("The native build output must stay inside the package.");
  }

  const rendererModules: NativeDevAppSourceModule[] = [];
  for (const [id, module] of Object.entries(manifest.rendererModules ?? {})) {
    const entryPath = await resolveExistingPackagePath(
      packageRoot,
      module.entry,
      `rendererModules.${id}.entry`,
    );
    const stylePath = module.styles
      ? await resolveExistingPackagePath(
          packageRoot,
          module.styles,
          `rendererModules.${id}.styles`,
        )
      : null;
    if (stylePath) {
      const violations = await validateScopedDevAppCss(
        await readFile(stylePath, "utf8"),
        manifest.id,
      );
      if (violations.length > 0) {
        throw new NativeDevAppBuildError(
          `Renderer stylesheet selectors must begin with [data-cozea-devapp="${manifest.id}"]. Invalid selectors: ${violations.join(", ")}`,
        );
      }
    }
    rendererModules.push({ id, entryPath, stylePath });
  }

  const extensionPath = manifest.extension
    ? await resolveExistingPackagePath(
        packageRoot,
        manifest.extension.entry,
        "extension.entry",
      )
    : null;
  const webSurfaceIds = manifest.contributes.surfaces
    .filter((surface) => surface.renderer.kind === "web-app")
    .map((surface) => surface.id);

  return {
    packageRoot,
    manifestPath,
    outputRoot,
    manifest,
    rendererModules,
    extensionPath,
    webSurfaceIds,
  };
}

function createRendererBoundaryPlugin(plan: NativeDevAppBuildPlan): Plugin {
  const entries = new Map(
    plan.rendererModules.map((module) => [`${ENTRY_PREFIX}${module.id}`, module]),
  );
  return {
    name: "cozea-native-devapp-boundary",
    enforce: "pre",
    async resolveId(source, importer, options) {
      if (source.startsWith(PUBLIC_ENTRY_PREFIX)) {
        return `${ENTRY_PREFIX}${source.slice(PUBLIC_ENTRY_PREFIX.length)}`;
      }
      const runtimeId = nativeDevAppRuntimeVirtualId(source);
      if (runtimeId) return runtimeId;
      if (classifyNativeDevAppImport(source) === "forbidden") {
        throw new NativeDevAppBuildError(
          `Native renderer code may not import ${JSON.stringify(source)}.`,
        );
      }
      if (!importer || (!source.startsWith(".") && !path.isAbsolute(source))) return null;
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      if (!resolved || resolved.external) return resolved;
      const cleanId = resolved.id.split("?", 1)[0]!;
      if (!isNodeModulesPath(cleanId) && !isInside(plan.packageRoot, cleanId)) {
        throw new NativeDevAppBuildError(
          `Native renderer import resolves outside the DevApp package: ${source}`,
        );
      }
      return resolved;
    },
    load(id) {
      const runtimeProxy = nativeDevAppRuntimeProxySource(id);
      if (runtimeProxy) return runtimeProxy;
      const module = entries.get(id);
      if (!module) return null;
      const imports = module.stylePath
        ? `import ${JSON.stringify(module.stylePath)};\n`
        : "";
      return `${imports}export { default } from ${JSON.stringify(module.entryPath)};\nexport * from ${JSON.stringify(module.entryPath)};\n`;
    },
  };
}

function createExtensionBoundaryPlugin(packageRoot: string): Plugin {
  return {
    name: "cozea-devapp-extension-boundary",
    enforce: "pre",
    async resolveId(source, importer, options) {
      if (source === "@cozea/devapp-api/extension") return EXTENSION_SDK_ID;
      if (
        NODE_IMPORTS.has(source) ||
        source === "electron" ||
        source === "react" ||
        source.startsWith("react/") ||
        source.startsWith("react-dom") ||
        FORBIDDEN_PREFIXES.some((prefix) => source.startsWith(prefix))
      ) {
        throw new NativeDevAppBuildError(
          `Extension-host code may not import ${JSON.stringify(source)} directly. Use the capability-scoped extension context.`,
        );
      }
      if (!importer || (!source.startsWith(".") && !path.isAbsolute(source))) return null;
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      if (!resolved || resolved.external) return resolved;
      const cleanId = resolved.id.split("?", 1)[0]!;
      if (!isNodeModulesPath(cleanId) && !isInside(packageRoot, cleanId)) {
        throw new NativeDevAppBuildError(
          `Extension import resolves outside the DevApp package: ${source}`,
        );
      }
      return resolved;
    },
    load(id) {
      if (id !== EXTENSION_SDK_ID) return null;
      return `
const KIND = "cozea.devapp-extension/v1";
export const DEV_APP_EXTENSION_DEFINITION_KIND = KIND;
export function defineDevAppExtension(definition) {
  return Object.freeze({ ...definition, kind: KIND });
}
export function isDevAppExtensionDefinition(value) {
  return Boolean(value && typeof value === "object" && value.kind === KIND && typeof value.activate === "function");
}
`;
    },
  };
}

async function sha256File(filePath: string): Promise<string> {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

async function listFiles(root: string): Promise<string[]> {
  const result: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new NativeDevAppBuildError(
          `Build output contains a symbolic link: ${path.relative(root, absolute)}`,
        );
      }
      if (entry.isDirectory()) {
        await visit(absolute);
      } else if (entry.isFile()) {
        result.push(absolute);
      }
    }
  };
  await visit(root);
  return result.sort();
}

async function buildRendererModules(
  plan: NativeDevAppBuildPlan,
): Promise<Record<string, { entry: string; styles?: string; contentHash: string }>> {
  if (plan.rendererModules.length === 0) return {};
  const rendererOut = path.join(plan.outputRoot, "renderer");
  const inputs = Object.fromEntries(
    plan.rendererModules.map((module) => [module.id, `${PUBLIC_ENTRY_PREFIX}${module.id}`]),
  );
  await viteBuild({
    configFile: false,
    root: plan.packageRoot,
    logLevel: "warn",
    plugins: [createRendererBoundaryPlugin(plan)],
    build: {
      outDir: rendererOut,
      emptyOutDir: true,
      target: "es2022",
      sourcemap: true,
      minify: false,
      cssCodeSplit: false,
      rollupOptions: {
        input: inputs,
        output: {
          entryFileNames: "[name].mjs",
          chunkFileNames: "chunks/[name]-[hash].mjs",
          assetFileNames: "assets/[name]-[hash][extname]",
        },
      },
    },
  });

  const cssFiles = (await listFiles(rendererOut)).filter((file) => file.endsWith(".css"));
  if (cssFiles.length > 1) {
    throw new NativeDevAppBuildError(
      "The first native builder supports one combined renderer stylesheet.",
    );
  }
  const styles = cssFiles[0]
    ? path.relative(plan.outputRoot, cssFiles[0]).replaceAll(path.sep, "/")
    : undefined;
  const result: Record<string, { entry: string; styles?: string; contentHash: string }> = {};
  for (const module of plan.rendererModules) {
    const outputPath = path.join(rendererOut, `${module.id}.mjs`);
    result[module.id] = {
      entry: path.relative(plan.outputRoot, outputPath).replaceAll(path.sep, "/"),
      ...(styles ? { styles } : {}),
      contentHash: await sha256File(outputPath),
    };
  }
  return result;
}

async function buildExtension(
  plan: NativeDevAppBuildPlan,
): Promise<{ entry: string; contentHash: string } | undefined> {
  if (!plan.extensionPath) return undefined;
  const extensionOut = path.join(plan.outputRoot, "extension");
  await viteBuild({
    configFile: false,
    root: plan.packageRoot,
    logLevel: "warn",
    plugins: [createExtensionBoundaryPlugin(plan.packageRoot)],
    build: {
      outDir: extensionOut,
      emptyOutDir: true,
      target: "es2022",
      sourcemap: true,
      minify: false,
      rollupOptions: {
        input: plan.extensionPath,
        output: {
          entryFileNames: "extension.mjs",
          chunkFileNames: "chunks/[name]-[hash].mjs",
          assetFileNames: "assets/[name]-[hash][extname]",
        },
      },
    },
  });
  const outputPath = path.join(extensionOut, "extension.mjs");
  return {
    entry: path.relative(plan.outputRoot, outputPath).replaceAll(path.sep, "/"),
    contentHash: await sha256File(outputPath),
  };
}

async function writeIntegrityFile(outputRoot: string): Promise<string> {
  const integrityPath = path.join(outputRoot, INTEGRITY_FILE);
  const files = (await listFiles(outputRoot)).filter((file) => file !== integrityPath);
  const hashes: Record<string, string> = {};
  for (const file of files) {
    hashes[path.relative(outputRoot, file).replaceAll(path.sep, "/")] = await sha256File(file);
  }
  await writeFile(
    integrityPath,
    `${JSON.stringify({ algorithm: "sha256", files: hashes }, null, 2)}\n`,
    "utf8",
  );
  return integrityPath;
}

/**
 * First executable slice of the native-first builder.
 *
 * It compiles native renderer and extension entries. Static/full-stack web adapters are
 * represented by the v3 contract and validated, but continue to use the existing artifact/runtime
 * pipeline until the unified multi-artifact release adapter lands.
 */
export async function buildNativeDevApp(options: {
  packageRoot: string;
  outputRoot?: string;
}): Promise<NativeDevAppBuildResult> {
  const plan = await createNativeDevAppBuildPlan(options);
  if (plan.rendererModules.length === 0) {
    throw new NativeDevAppBuildError(
      "This package has no native React renderer module to compile.",
    );
  }
  if (plan.webSurfaceIds.length > 0 || Object.keys(plan.manifest.services ?? {}).length > 0) {
    throw new NativeDevAppBuildError(
      "The native compiler slice does not yet package web applications or services. Their existing runtime remains active until the multi-artifact adapter lands.",
    );
  }

  await rm(plan.outputRoot, { recursive: true, force: true });
  await mkdir(plan.outputRoot, { recursive: true });
  const rendererModules = await buildRendererModules(plan);
  const extension = await buildExtension(plan);
  const permissions = requestedDevAppCapabilitiesV3(plan.manifest);
  const release: DevAppReleaseManifestV1 = {
    releaseManifestVersion: DEV_APP_RELEASE_MANIFEST_VERSION,
    appId: plan.manifest.id,
    appVersion: plan.manifest.version,
    nativeApi: plan.manifest.engines.nativeApi,
    ...(plan.manifest.description ? { description: plan.manifest.description } : {}),
    rendererModules,
    ...(extension ? { extension } : {}),
    permissions,
    contributes: plan.manifest.contributes,
  };
  const releasePath = path.join(plan.outputRoot, RELEASE_FILE);
  await writeFile(releasePath, `${JSON.stringify(release, null, 2)}\n`, "utf8");
  const integrityPath = await writeIntegrityFile(plan.outputRoot);
  return { plan, release, releasePath, integrityPath };
}

export async function copyNativeDevAppBuild(
  sourceRoot: string,
  destinationRoot: string,
): Promise<void> {
  await rm(destinationRoot, { recursive: true, force: true });
  await mkdir(path.dirname(destinationRoot), { recursive: true });
  await cp(sourceRoot, destinationRoot, { recursive: true, errorOnExist: true });
}
