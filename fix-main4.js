const fs = require('fs');
let file = fs.readFileSync('electron/main.ts', 'utf8');

file = file.replace(
  "app.whenReady().then(() => {",
  "// Sync macOS PATH/SSH before initializing services\nif (process.platform === 'darwin') {\n  syncShellEnvironment()\n}\n\napp.whenReady().then(() => {"
);

fs.writeFileSync('electron/main.ts', file);
