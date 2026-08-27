#!/usr/bin/env node

const payload = process.argv.slice(2).join(" ").trim();

if (payload) {
  process.stdout.write(`__COZEA_NATIVE_PREVIEW__open_editor__ ${payload}\n`);
}
