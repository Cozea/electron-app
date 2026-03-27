const fs = require('fs');
let file = fs.readFileSync('src/features/projects/components/TerminalInstance.tsx', 'utf8');

const start = file.indexOf('{selectedText.trim().length > 0 && (');
const end = file.indexOf('</Tooltip>', start) + '</Tooltip>'.length + 10;
file = file.substring(0, start) + file.substring(end);

fs.writeFileSync('src/features/projects/components/TerminalInstance.tsx', file);
