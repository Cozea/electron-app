const fs = require('fs');
let terminalLinks = fs.readFileSync('src/lib/terminalLinks.ts', 'utf8');

terminalLinks = terminalLinks.replace(
  ".toSorted((a, b) => a.start - b.start)",
  ".sort((a, b) => a.start - b.start)"
);

fs.writeFileSync('src/lib/terminalLinks.ts', terminalLinks);

let terminalInstance = fs.readFileSync('src/features/projects/components/TerminalInstance.tsx', 'utf8');
terminalInstance = terminalInstance.replace(
  "import { useProjectStore } from '@/stores/useProjectStore'",
  ""
);

terminalInstance = terminalInstance.replace(
  "const projectPath = useProjectStore.getState().currentProject?.path || ''",
  "const projectPath = useTerminalStore.getState().terminals[terminalId]?.projectPath || ''"
);

fs.writeFileSync('src/features/projects/components/TerminalInstance.tsx', terminalInstance);
