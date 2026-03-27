const fs = require('fs');
let file = fs.readFileSync('electron.vite.config.ts', 'utf8');

file = file.replace(
  "'@shared': path.resolve(__dirname, './shared'),\n        '@t3tools/contracts': path.resolve(__dirname, './shared/t3-contracts'),\n        '@t3tools/shared': path.resolve(__dirname, './shared/t3-shared'),",
  "'@shared': path.resolve(__dirname, './shared'),"
);

fs.writeFileSync('electron.vite.config.ts', file);
