const fs = require('fs');
let file = fs.readFileSync('electron/t3-server/main.ts', 'utf8');
file = file.replace(
  /const makeServerRuntimeProgram = \(input: CliInput\)/g,
  'export const makeServerRuntimeProgram = (input: CliInput)'
);
fs.writeFileSync('electron/t3-server/main.ts', file);
