import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { patchT3ServerBundleMediaContainment } from "../../scripts/prepare-t3-runtime.mjs";

const server = path.resolve(__dirname, "../../vendor/t3code/apps/server");
const bundle = fs.readFileSync(path.join(server, "dist/bin.mjs"), "utf8");

it("requires unique known patch anchors and is idempotent", () => {
  const patched = patchT3ServerBundleMediaContainment(bundle);
  expect(patched.source.includes("Cozea: generic media stays inside its bound workspace.")).toBe(
    true,
  );
  const repeated = patchT3ServerBundleMediaContainment(patched.source);
  expect(repeated.changed).toBe(false);
  expect(repeated.source === patched.source).toBe(true);
  expect(() => patchT3ServerBundleMediaContainment("unrecognized bundle")).toThrow("anchor");
  expect(() => patchT3ServerBundleMediaContainment(bundle + bundle)).toThrow("anchor");
  const suffix = '\t\tcase "workspace-file": {';
  const start = bundle.indexOf("const issueAssetUrl =");
  expect(
    patched.source.slice(patched.source.indexOf(suffix, start)) ===
      bundle.slice(bundle.indexOf(suffix, start)),
  ).toBe(true);
});

it("patches the pinned original media resolution without changing its error mapping", () => {
  const original = `\t\tcase "media-file": {
\t\t\tlet requestedPath = input.resource.path;
\t\t\tif (!path.isAbsolute(requestedPath)) {
\t\t\t\tif (!input.workspaceRoot) return yield* new AssetWorkspaceContextNotFoundError({ resource: input.resource });
\t\t\t\tconst workspaceRoot = yield* workspacePaths.normalizeWorkspaceRoot(input.workspaceRoot).pipe(mapError((cause) => new AssetWorkspaceRootNormalizationError({
\t\t\t\t\tresource: input.resource,
\t\t\t\t\tcause
\t\t\t\t})));
\t\t\t\trequestedPath = path.resolve(workspaceRoot, requestedPath);
\t\t\t}
\t\t\tconst canonicalFile = yield* resolveCanonicalFile(requestedPath).pipe(mapError((cause) => new AssetWorkspaceAssetInspectionError({`;
  const result = patchT3ServerBundleMediaContainment(original);
  expect(result.changed).toBe(true);
  expect(result.source).toContain("resolveCanonicalWorkspaceFile({ workspaceRoot, relativePath })");
  expect(result.source).toContain("path.relative(workspaceRoot, input.resource.path)");
  expect(result.source.endsWith("new AssetWorkspaceAssetInspectionError({")).toBe(true);
  expect(() => patchT3ServerBundleMediaContainment(original + result.source)).toThrow("anchor");
});

it("executes the patched mint branch with native workspace resolver, filesystem and inode checks", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "cozea-media-containment-"));
  try {
    const root = path.join(temp, "workspace");
    fs.mkdirSync(root);
    fs.writeFileSync(path.join(root, "inside.png"), "inside");
    fs.writeFileSync(path.join(root, "secret.txt"), "secret");
    const outside = path.join(temp, "outside.png");
    fs.writeFileSync(outside, "outside");
    fs.symlinkSync(outside, path.join(root, "escape.png"));
    fs.symlinkSync(path.join(root, "inside.png"), path.join(root, "safe.png"));
    fs.symlinkSync(path.join(root, "secret.txt"), path.join(root, "disguised.png"));
    fs.symlinkSync(path.join(server, "node_modules"), path.join(temp, "node_modules"));
    let source = patchT3ServerBundleMediaContainment(bundle).source;
    // Test only the real media mint branch, before signing (no server/auth start).
    // All resolver/type/openMediaFile implementations remain the bundled ones.
    const start = source.indexOf("const issueAssetUrl =");
    const end = source.indexOf('\t\tcase "workspace-file": {', start);
    const branch = source.slice(start, end);
    expect(branch).toContain("\t\t\tbreak;");
    source =
      source.slice(0, start) +
      branch.replace("\t\t\tbreak;", "\t\t\treturn { claims, fileName };") +
      source.slice(end);
    source = source.replace(
      /(from\s+|import\()"\.\/([^"\n]+)"/g,
      (_match, prefix: string, name: string) =>
        `${prefix}${JSON.stringify(pathToFileURL(path.join(server, "dist", name)).href)}`,
    );
    source +=
      "\nexport const testMintMedia = input => runPromise(issueAssetUrl(input).pipe(scoped$1, provide$2(layer$72.pipe(provideMerge(layer$104)))));\n";
    fs.writeFileSync(path.join(temp, "probe.mjs"), source);
    const cases = [
      { name: "relative", path: "inside.png", workspaceRoot: root },
      { name: "absolute", path: path.join(root, "inside.png"), workspaceRoot: root },
      { name: "safe-link", path: "safe.png", workspaceRoot: root },
      { name: "traversal", path: "../outside.png", workspaceRoot: root },
      { name: "absolute-outside", path: outside, workspaceRoot: root },
      { name: "concatenated-escape", path: `${root}/../outside.png`, workspaceRoot: root },
      { name: "symlink-escape", path: "escape.png", workspaceRoot: root },
      { name: "absolute-symlink-escape", path: path.join(root, "escape.png"), workspaceRoot: root },
      { name: "missing-context", path: outside },
      { name: "unsupported", path: "secret.txt", workspaceRoot: root },
      { name: "disguised", path: "disguised.png", workspaceRoot: root },
      { name: "directory", path: root, workspaceRoot: root },
    ];
    fs.writeFileSync(
      path.join(temp, "run.mjs"),
      `import {testMintMedia} from './probe.mjs';\nconst results=[];for(const c of ${JSON.stringify(cases)}){try{results.push({name:c.name,value:await testMintMedia({workspaceRoot:c.workspaceRoot,resource:{_tag:'media-file',threadId:'fixture',path:c.path}})});}catch(error){results.push({name:c.name,error:String(error)});}}console.log(JSON.stringify(results));`,
    );
    const result = spawnSync(process.execPath, [path.join(temp, "run.mjs")], {
      encoding: "utf8",
      timeout: 30_000,
    });
    expect(result.status, result.stderr).toBe(0);
    const results = JSON.parse(result.stdout.trim().split("\n").at(-1)!) as Array<{
      name: string;
      value?: { claims: { kind: string; filePath: string; device: string; inode: string } };
      error?: string;
    }>;
    for (const name of ["relative", "absolute", "safe-link"]) {
      expect(results.find((r) => r.name === name)?.value?.claims).toMatchObject({
        kind: "media-file-exact",
        filePath: fs.realpathSync(path.join(root, "inside.png")),
        device: expect.any(String),
        inode: expect.any(String),
      });
    }
    for (const name of cases.slice(3).map((c) => c.name)) {
      expect(results.find((r) => r.name === name)?.error, name).toBeTruthy();
    }
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}, 40_000);
