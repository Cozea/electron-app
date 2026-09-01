import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { DEV_APP_PACKAGE_JSON_SCHEMA } from "../shared/devAppPackage";

const root = path.resolve(import.meta.dir, "..");
const outputPaths = [
  path.join(root, "packages/devapp-api/schema/cozea-devapp.schema.json"),
  path.join(root, "apps/desktop/public/cozea-devapp.schema.json"),
];
const rendered = `${JSON.stringify(DEV_APP_PACKAGE_JSON_SCHEMA, null, 2)}\n`;
const documentationSourcePath = path.join(root, "docs/devapp-authoring.md");
const publicDocumentationPath = path.join(root, "apps/desktop/public/devapp-authoring.md");
const publicDocumentation = await readFile(documentationSourcePath, "utf8");
const sharedContractFiles = [
  "devAppCapabilities.ts",
  "devAppPackage.ts",
  "devAppViewBridge.ts",
  "devAppWorkerProtocol.ts",
];
const generatedContractCopies = await Promise.all(
  sharedContractFiles.map(async (filename) => ({
    outputPath: path.join(root, "packages/devapp-api/src/shared", filename),
    contents: await readFile(path.join(root, "shared", filename), "utf8"),
  })),
);
const check = process.argv.includes("--check");

if (check) {
  const currentSchemas = await Promise.all(
    outputPaths.map((outputPath) => readFile(outputPath, "utf8").catch(() => "")),
  );
  const currentDocumentation = await readFile(publicDocumentationPath, "utf8").catch(() => "");
  const currentContractCopies = await Promise.all(
    generatedContractCopies.map(({ outputPath }) => readFile(outputPath, "utf8").catch(() => "")),
  );
  if (
    currentSchemas.some((current) => current !== rendered) ||
    currentDocumentation !== publicDocumentation ||
    currentContractCopies.some(
      (current, index) => current !== generatedContractCopies[index]?.contents,
    )
  ) {
    console.error("Generated DevApp authoring assets are stale; run bun run devapp:generate");
    process.exitCode = 1;
  }
} else {
  for (const outputPath of outputPaths) {
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, rendered, "utf8");
  }
  await mkdir(path.dirname(publicDocumentationPath), { recursive: true });
  await writeFile(publicDocumentationPath, publicDocumentation, "utf8");
  for (const { outputPath, contents } of generatedContractCopies) {
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, contents, "utf8");
  }
}
