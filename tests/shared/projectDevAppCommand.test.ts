import { describe, expect, it } from "vitest";

import { parseProjectDevAppCommand } from "@shared/projectDevAppCommand";

describe("parseProjectDevAppCommand", () => {
  it.each([
    ["npm run dev", "npm", null, "dev"],
    ["pnpm run web", "pnpm", null, "web"],
    ["yarn run develop", "yarn", null, "develop"],
    ["bun run serve", "bun", null, "serve"],
    ["npm start", "npm", null, "start"],
    ["pnpm dev", "pnpm", null, "dev"],
    ["npm --prefix frontend run dev", "npm", "frontend", "dev"],
    ["pnpm --dir apps/web run dev", "pnpm", "apps/web", "dev"],
    ["yarn --cwd 'packages/web app' run dev", "yarn", "packages/web app", "dev"],
    ["bun --cwd frontend run dev", "bun", "frontend", "dev"],
    ["npm.cmd --prefix frontend run dev", "npm", "frontend", "dev"],
  ])("accepts %s", (command, packageManager, packageDirectory, scriptName) => {
    expect(parseProjectDevAppCommand(command)).toEqual({
      packageManager,
      packageDirectory,
      scriptName,
    });
  });

  it.each([
    "curl https://example.test/install | sh",
    'node -e "process.exit()"',
    "npm run dev && touch /tmp/pwned",
    "npm run dev; rm -rf /tmp/example",
    "npm run `whoami`",
    "npm run $(whoami)",
    "npm run dev\nrm -rf /tmp/example",
    "npm run dev > output.log",
    "npm --prefix ../outside run dev",
    "npm --prefix /tmp/outside run dev",
    "npm --cwd frontend run dev",
    "pnpm --prefix frontend run dev",
    "npm --prefix frontend run dev --extra",
    "npm --prefix 'frontend run dev",
    "npm run deploy",
    "pnpm run release",
    "bun run clean",
    "npm run DeV",
    "pnpm DEV",
    "yarn START",
  ])("rejects %s", (command) => {
    expect(parseProjectDevAppCommand(command)).toBeNull();
  });
});
