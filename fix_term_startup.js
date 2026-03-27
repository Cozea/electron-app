const fs = require('fs');
let sidebar = fs.readFileSync('src/components/terminal/AITerminalSidebar.tsx', 'utf8');

// There might be duplicate imports now. Let's clean it up just in case.
const importTermStore = "import { useTerminalStore } from '@/stores/useTerminalStore'";
const count = (sidebar.match(new RegExp(importTermStore, 'g')) || []).length;
if (count > 1) {
    sidebar = sidebar.replace(importTermStore + '\n', '');
}
fs.writeFileSync('src/components/terminal/AITerminalSidebar.tsx', sidebar);

