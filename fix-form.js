const fs = require('fs');
let file = fs.readFileSync('src/components/terminal/AITerminalSidebar.tsx', 'utf8');

// add ArrowLeft, Upload imports
file = file.replace(
  "import { Bot, Plus, Terminal, X } from 'lucide-react'",
  "import { Bot, Plus, Terminal, X, ArrowLeft, Upload } from 'lucide-react'"
);

// add KNOWN_CLIS array
const knownClisCode = `
const KNOWN_CLIS = [
  { command: 'npm install -g @anthropic-ai/claude-code', name: 'Claude Code', icon: SiAnthropic, color: 'text-[#d97757]' },
  { command: 'npm install -g @google/gemini-cli', name: 'Gemini CLI', icon: SiGooglegemini, color: 'text-[#8E75B2]' },
  { command: 'npm install -g @githubnext/github-copilot-cli', name: 'Copilot', icon: SiGithubcopilot, color: 'text-[#8A2BE2]' },
  { command: 'npm install -g openai-codex-cli', name: 'Codex', icon: SiOpenai, color: 'text-[#10a37f]' },
  { command: 'npm install -g kilo-code', name: 'Kilo Code', icon: Bot, color: 'text-primary' },
]
`;

file = file.replace("const EMPTY_SESSIONS", knownClisCode + "\nconst EMPTY_SESSIONS");

// inject state
file = file.replace(
  "const [isCreatingNew, setIsCreatingNew] = useState(false)",
  "const [isCreatingNew, setIsCreatingNew] = useState(false)\n  const [isInstallingAgent, setIsInstallingAgent] = useState(false)\n  const [installCommand, setInstallCommand] = useState('')\n\n  const recognizedCli = useMemo(() => {\n    if (!installCommand.trim()) return null\n    return KNOWN_CLIS.find(cli => installCommand.includes(cli.command) || cli.command.includes(installCommand.trim()))\n  }, [installCommand])"
);

// replace grid rendering to toggle between form and grid
const gridStart = `            <div className="flex flex-1 flex-col items-center justify-center p-4">
              <div className="w-full max-w-sm space-y-4">
                <div className="text-center space-y-1">
                  <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-secondary mb-3">
                    <Terminal className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <h3 className="text-sm font-medium text-foreground">Launch an AI agent</h3>
                </div>`;

const gridStartReplacement = `            <div className="flex flex-1 flex-col items-center justify-center p-4">
              {isInstallingAgent ? (
                <div className="w-full max-w-sm space-y-6">
                  <div className="flex items-center gap-2">
                    <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => { setIsInstallingAgent(false); setInstallCommand(''); }}>
                      <ArrowLeft className="h-4 w-4" />
                    </Button>
                    <h3 className="text-sm font-medium text-foreground">Add Custom CLI</h3>
                  </div>
                  
                  <div className="flex flex-col items-center gap-6">
                    <div className="flex h-20 w-20 shrink-0 items-center justify-center bg-secondary transition-all hover:bg-secondary/80 group cursor-pointer relative overflow-hidden">
                      {recognizedCli ? (
                        <recognizedCli.icon className={cn("h-10 w-10", recognizedCli.color)} />
                      ) : (
                        <Upload className="h-8 w-8 text-muted-foreground" />
                      )}
                      <div className="absolute inset-0 bg-background/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                        <Upload className="h-6 w-6 text-foreground" />
                      </div>
                    </div>

                    <div className="w-full space-y-2">
                      <label className="text-xs font-medium text-muted-foreground ml-1">Install Command</label>
                      <input
                        list="known-clis"
                        value={installCommand}
                        onChange={(e) => setInstallCommand(e.target.value)}
                        placeholder="e.g. npm install -g my-cli"
                        className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                      />
                      <datalist id="known-clis">
                        {KNOWN_CLIS.map(cli => (
                          <option key={cli.command} value={cli.command}>{cli.name}</option>
                        ))}
                      </datalist>
                    </div>

                    <Button 
                      className="w-full mt-2" 
                      disabled={!installCommand.trim()}
                      onClick={() => {
                        console.log('Installing:', installCommand)
                        setIsInstallingAgent(false)
                        setInstallCommand('')
                      }}
                    >
                      Install Agent
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="w-full max-w-sm space-y-4">
                  <div className="text-center space-y-1">
                    <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-secondary mb-3">
                      <Terminal className="h-5 w-5 text-muted-foreground" />
                    </div>
                    <h3 className="text-sm font-medium text-foreground">Launch an AI agent</h3>
                  </div>`;

file = file.replace(gridStart, gridStartReplacement);

const installButtonClick = `                  <button
                    onClick={() => console.log('Install CLI agent clicked')}
                    className="group flex flex-col items-center gap-2 outline-none w-full"
                  >`;

const installButtonClickReplacement = `                  <button
                    onClick={() => setIsInstallingAgent(true)}
                    className="group flex flex-col items-center gap-2 outline-none w-full"
                  >`;

file = file.replace(installButtonClick, installButtonClickReplacement);

// We also need to add closing tags for the if block
const gridEnd = `                  </button>
                </div>
              </div>
            </div>`;
const gridEndReplacement = `                  </button>
                </div>
              </div>
              )}
            </div>`;

file = file.replace(gridEnd, gridEndReplacement);

fs.writeFileSync('src/components/terminal/AITerminalSidebar.tsx', file);
