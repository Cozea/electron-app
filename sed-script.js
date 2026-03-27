const fs = require('fs');
const file = fs.readFileSync('src/components/terminal/AITerminalSidebar.tsx', 'utf8');

// replace imports
let newFile = file.replace(
  "import { Bot, Maximize2, Minimize2, Plus, Terminal, X } from 'lucide-react'",
  "import { Bot, Maximize2, Minimize2, Plus, Terminal, X, Code2 } from 'lucide-react'\nimport { SiAnthropic, SiGooglegemini, SiGnubash } from 'react-icons/si'"
);

// update interface
newFile = newFile.replace(
  "interface AITerminalProfile {\n  id: AgentToolId\n  name: string\n}",
  "interface AITerminalProfile {\n  id: AgentToolId\n  name: string\n  icon: React.ElementType\n  color: string\n}"
);

// update PROFILES
newFile = newFile.replace(
  "const AI_TERMINAL_PROFILES: AITerminalProfile[] = [\n  { id: 'claude', name: 'Claude Code' },\n  { id: 'gemini', name: 'Gemini CLI' },\n  { id: 'kilo', name: 'Kilo Code' },\n  { id: 'shell', name: 'Shell' },\n]",
  "const AI_TERMINAL_PROFILES: AITerminalProfile[] = [\n  { id: 'claude', name: 'Claude Code', icon: SiAnthropic, color: 'text-[#d97757]' },\n  { id: 'gemini', name: 'Gemini CLI', icon: SiGooglegemini, color: 'text-[#8E75B2]' },\n  { id: 'kilo', name: 'Kilo Code', icon: Bot, color: 'text-primary' },\n  { id: 'shell', name: 'Shell', icon: Terminal, color: 'text-muted-foreground' },\n]"
);

fs.writeFileSync('src/components/terminal/AITerminalSidebar.tsx', newFile);
