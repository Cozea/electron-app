const fs = require('fs');
let terminalInstance = fs.readFileSync('src/features/projects/components/TerminalInstance.tsx', 'utf8');

terminalInstance = terminalInstance.replace(
  "activate: (event: MouseEvent, text: string) => {",
  "activate: (event: MouseEvent, _text: string) => {"
);

fs.writeFileSync('src/features/projects/components/TerminalInstance.tsx', terminalInstance);

let terminalLinks = fs.readFileSync('src/lib/terminalLinks.ts', 'utf8');
terminalLinks = terminalLinks.replace(
  /return `\$\{resolvedPath\}:\$\{line\}\$\{column \? `:\$\{column\}` : ""\}`/,
  "return `${resolvedPath}:${line}${column ? `:${column}` : ''}`"
);
fs.writeFileSync('src/lib/terminalLinks.ts', terminalLinks);
