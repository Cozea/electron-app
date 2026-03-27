const fs = require('fs');
let file = fs.readFileSync('src/components/terminal/AITerminalSidebar.tsx', 'utf8');

file = file.replace(
  "import { ensureNativeApi } from '@/lib/nativeApi'\n",
  ""
);

fs.writeFileSync('src/components/terminal/AITerminalSidebar.tsx', file);
