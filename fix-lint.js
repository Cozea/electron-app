const fs = require('fs');
let file = fs.readFileSync('src/features/projects/components/TerminalInstance.tsx', 'utf8');

file = file.replace(
  "const EMPTY_ARRAY: string[] = []",
  ""
);

file = file.replace(
  "const { appendTerminalOutput, setTerminalHasOutput, updateTerminalStatus } = useTerminalActions()",
  "const { appendTerminalOutput, updateTerminalStatus } = useTerminalActions()"
);

fs.writeFileSync('src/features/projects/components/TerminalInstance.tsx', file);
