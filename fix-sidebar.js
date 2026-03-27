const fs = require('fs');
let file = fs.readFileSync('src/components/terminal/AITerminalSidebar.tsx', 'utf8');

const profileInterfaceRegex = /interface AITerminalProfile \{\n  id: AgentToolId\n  name: string\n  icon: React.ElementType\n  color: string\n\}/;
file = file.replace(
  profileInterfaceRegex,
  `interface AITerminalProfile {
  id: AgentToolId
  name: string
  icon: React.ElementType
  color: string
  supportedModes: ('cli' | 'gui')[]
}`
);

const profilesRegex = /const AI_TERMINAL_PROFILES: AITerminalProfile\[\] = \[\n  \{ id: 'claude', name: 'Claude Code', icon: SiAnthropic, color: 'text-\[#d97757\]' \},\n  \{ id: 'gemini', name: 'Gemini CLI', icon: SiGooglegemini, color: 'text-\[#8E75B2\]' \},\n  \{ id: 'copilot', name: 'Copilot', icon: SiGithubcopilot, color: 'text-\[#8A2BE2\]' \},\n  \{ id: 'codex', name: 'Codex', icon: SiOpenai, color: 'text-\[#10a37f\]' \},\n  \{ id: 'kilo', name: 'Kilo Code', icon: Bot, color: 'text-primary' \},\n  \{ id: 'shell', name: 'Shell', icon: Terminal, color: 'text-muted-foreground' \},\n\]/;

file = file.replace(
  profilesRegex,
  `const AI_TERMINAL_PROFILES: AITerminalProfile[] = [
  { id: 'claude', name: 'Claude Code', icon: SiAnthropic, color: 'text-[#d97757]', supportedModes: ['cli', 'gui'] },
  { id: 'gemini', name: 'Gemini CLI', icon: SiGooglegemini, color: 'text-[#8E75B2]', supportedModes: ['cli'] },
  { id: 'copilot', name: 'Copilot', icon: SiGithubcopilot, color: 'text-[#8A2BE2]', supportedModes: ['cli'] },
  { id: 'codex', name: 'Codex', icon: SiOpenai, color: 'text-[#10a37f]', supportedModes: ['cli'] },
  { id: 'kilo', name: 'Kilo Code', icon: Bot, color: 'text-primary', supportedModes: ['cli'] },
  { id: 'shell', name: 'Shell', icon: Terminal, color: 'text-muted-foreground', supportedModes: ['cli'] },
]`
);

// Add viewMode state
const stateRegex = /  const \[isCreatingNew, setIsCreatingNew\] = useState\(false\)/;
file = file.replace(
  stateRegex,
  `  const [isCreatingNew, setIsCreatingNew] = useState(false)
  const [viewMode, setViewMode] = useState<'cli'|'gui'>('gui')`
);

// We need to import MessagesTimeline
const importsRegex = /import \{ TerminalInstance \} from '@\/features\/projects\/components\/TerminalInstance'/;
file = file.replace(
  importsRegex,
  `import { TerminalInstance } from '@/features/projects/components/TerminalInstance'
import { MessagesTimeline } from '@/features/projects/components/assistant/chat/MessagesTimeline'`
);

fs.writeFileSync('src/components/terminal/AITerminalSidebar.tsx', file);
