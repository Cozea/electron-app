const code = require('fs').readFileSync('src/features/projects/components/TerminalInstance.tsx', 'utf8');
const lines = code.split('\n');
console.log(lines.slice(50, 65).join('\n'));
