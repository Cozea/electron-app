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
      {
        find: /^@cozea\/effect-acp\/(.*)$/,
        replacement: resolveFromRoot("./packages/effect-acp/src/$1"),
      },
      {
        find: /^@cozea\/effect-acp$/,
        replacement: resolveFromRoot("./packages/effect-acp/src/client.ts"),
      },
      {
        find: /^effect\/Context$/,
        replacement: resolveFromRoot("./test-support/effect-context.ts"),
      },
      {
        find: /^@effect\/sql\/SqlClient$/,
        replacement: resolveFromRoot("./node_modules/effect/dist/unstable/sql/SqlClient.js"),
      },
      {
        find: /^@effect\/sql\/SqlConnection$/,
        replacement: resolveFromRoot("./node_modules/effect/dist/unstable/sql/SqlConnection.js"),
      },
      {
        find: /^@effect\/sql\/SqlError$/,
        replacement: resolveFromRoot("./node_modules/effect/dist/unstable/sql/SqlError.js"),
      },
      {
        find: /^@effect\/sql\/Statement$/,
        replacement: resolveFromRoot("./node_modules/effect/dist/unstable/sql/Statement.js"),
      },
    ],
  },
  test: {
    environment: "node",
    include: [
      "electron/*.test.ts",
      "electron/assistant-runtime/**/*.test.ts",
      "shared/assistant-shared/*.test.ts",
      "shared/assistant-contracts/*.test.ts",
    ],
  },
});
