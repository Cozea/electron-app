const fs = require('fs');
let file = fs.readFileSync('electron/main.ts', 'utf8');

// Insert import at the top
file = file.replace(
  "import { app, BrowserWindow, shell, ipcMain, nativeTheme, session } from 'electron'",
  "import { app, BrowserWindow, shell, ipcMain, nativeTheme, session } from 'electron'\nimport { syncShellEnvironment } from './syncShellEnvironment'"
);

// Call sync right before app.whenReady
file = file.replace(
  "app.whenReady().then(async () => {",
  "// Sync macOS PATH/SSH before initializing services\nif (process.platform === 'darwin') {\n  syncShellEnvironment()\n}\n\napp.whenReady().then(async () => {"
);

fs.writeFileSync('electron/main.ts', file);
