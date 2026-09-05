import path from "node:path";

import {
  buildNativeDevApp,
  createNativeDevAppBuildPlan,
  NativeDevAppBuildError,
} from "./native-builder";

function usage(): never {
  console.error(
    "Usage: bun run scripts/devapps/native-builder-cli.ts <validate|build> [package-root] [output-root]",
  );
  process.exit(2);
}

const [command, packageRootArgument = ".", outputRootArgument] = process.argv.slice(2);
if (command !== "validate" && command !== "build") usage();

const packageRoot = path.resolve(packageRootArgument);
const outputRoot = outputRootArgument ? path.resolve(outputRootArgument) : undefined;

try {
  if (command === "validate") {
    const plan = await createNativeDevAppBuildPlan({ packageRoot, outputRoot });
    console.log(
      JSON.stringify(
        {
          valid: true,
          appId: plan.manifest.id,
          version: plan.manifest.version,
          rendererModules: plan.rendererModules.map((module) => module.id),
          extension: Boolean(plan.extensionPath),
          webSurfaces: plan.webSurfaceIds,
        },
        null,
        2,
      ),
    );
  } else {
    const result = await buildNativeDevApp({ packageRoot, outputRoot });
    console.log(
      JSON.stringify(
        {
          built: true,
          appId: result.release.appId,
          version: result.release.appVersion,
          outputRoot: result.plan.outputRoot,
          releasePath: result.releasePath,
          integrityPath: result.integrityPath,
        },
        null,
        2,
      ),
    );
  }
} catch (error) {
  if (error instanceof NativeDevAppBuildError) {
    console.error(error.message);
    for (const diagnostic of error.diagnostics) {
      console.error(
        `${diagnostic.field ? `${diagnostic.field}: ` : ""}${diagnostic.message}`,
      );
    }
  } else {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  }
  process.exitCode = 1;
}
