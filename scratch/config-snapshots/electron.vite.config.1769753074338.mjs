// electron.vite.config.ts
import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
var __electron_vite_injected_dirname = "/Users/kelyan/Documents/Coding/electron-app";
var electron_vite_config_default = defineConfig({
  main: {
    build: {
      lib: {
        entry: "electron/main.ts"
      },
      rollupOptions: {
        external: ["electron", "@vscode/ripgrep", "node-pty", "xxhash-wasm"],
        output: {
          format: "cjs",
          entryFileNames: "index.js"
        }
      }
    }
  },
  preload: {
    build: {
      lib: {
        entry: "electron/preload.ts"
      },
      rollupOptions: {
        output: {
          format: "cjs",
          entryFileNames: "index.js"
        }
      }
    }
  },
  renderer: {
    root: ".",
    plugins: [react(), tailwindcss()],
    server: {
      host: "localhost",
      port: 5183
    },
    resolve: {
      alias: {
        "@": path.resolve(__electron_vite_injected_dirname, "./src")
      }
    },
    build: {
      rollupOptions: {
        input: "index.html"
      }
    }
  }
});
export {
  electron_vite_config_default as default
};
