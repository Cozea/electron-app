import { defineConfig } from "vitest/config";
import path from "node:path";

const resolveFromRoot = (relativePath: string) => path.resolve(__dirname, relativePath);

export default defineConfig({
  resolve: {
    alias: [
      { find: "@", replacement: resolveFromRoot("./src") },
      { find: "@shared", replacement: resolveFromRoot("./shared") },
      {
        find: /^@cozea\/assistant-contracts$/,
        replacement: resolveFromRoot("./shared/assistant-contracts/index.ts"),
      },
      {
        find: /^@cozea\/assistant-contracts\/(.*)$/,
        replacement: resolveFromRoot("./shared/assistant-contracts/$1"),
      },
      {
        find: /^@cozea\/assistant-shared$/,
        replacement: resolveFromRoot("./shared/assistant-shared/index.ts"),
      },
      {
        find: /^@cozea\/assistant-shared\/(.*)$/,
        replacement: resolveFromRoot("./shared/assistant-shared/$1"),
      },
    ],
  },
  test: {
    environment: "node",
    include: [
      "tests/shared/assistant-contracts/*.test.ts",
      "tests/electron/assistant-runtime/keybindings.test.ts",
    ],
  },
});
