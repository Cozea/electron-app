import fs from "node:fs";
import path from "node:path";

import { isSha256Digest } from "../shared/devAppContainedRuntime";

interface BuildPlan {
  sourceDigest: string;
  packageManifestDigest: string;
  parts: unknown;
  materials: Array<{ uri: string; digest: string }>;
}

function argument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}

const plan = JSON.parse(fs.readFileSync(path.resolve(argument("--plan")), "utf8")) as BuildPlan;
const repository = argument("--repository");
const manifestDigest = argument("--manifest-digest");
const arm64Digest = argument("--arm64-digest");
const amd64Digest = argument("--amd64-digest");
const output = path.resolve(argument("--output"));
if (
  !/^[a-z0-9./_-]+$/.test(repository) ||
  !isSha256Digest(manifestDigest) ||
  !isSha256Digest(arm64Digest) ||
  !isSha256Digest(amd64Digest) ||
  !/^[a-f0-9]{64}$/.test(plan.sourceDigest) ||
  !isSha256Digest(plan.packageManifestDigest)
) {
  throw new Error("The central build output identity is invalid.");
}
const build = {
  reference: `${repository}@${manifestDigest}`,
  manifestDigest,
  sourceDigest: plan.sourceDigest,
  packageManifestDigest: plan.packageManifestDigest,
  platforms: [
    { platform: "linux/arm64", digest: arm64Digest },
    { platform: "linux/amd64", digest: amd64Digest },
  ],
  materials: plan.materials,
  builtAt: Date.now(),
};
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(build, null, 2)}\n`, "utf8");
