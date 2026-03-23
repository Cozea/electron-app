const fs = require('fs');
let content = fs.readFileSync('src/components/wizard/steps/ReviewStep.tsx', 'utf8');

// Imports
content = content.replace(
  "import { IntegrationIcon } from '@/components/integrations/IntegrationIcon'",
  "import { IntegrationIcon } from '@/components/integrations/IntegrationIcon'\nimport { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'\nimport { Input } from '@/components/ui/input'"
);

// ReviewStepProps
content = content.replace(
  "  className?: string\n}",
  "  className?: string\n  onUpdateSourceControl?: (sourceControl: any) => void\n}"
);

// ReviewStep destructured props
content = content.replace(
  "  importSyncMessage,\n  className,\n}: ReviewStepProps) {",
  "  importSyncMessage,\n  className,\n  onUpdateSourceControl,\n}: ReviewStepProps) {"
);

// Remove "Edit" button for Sync if onUpdateSourceControl is provided
content = content.replace(
  `                <button \n                  onClick={() => onEditStep(resolveEditStep('repo-source', 1))}\n                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"\n                >\n                  <Pencil className="h-3 w-3" />\n                  <span>Edit</span>\n                </button>`,
  `                {!onUpdateSourceControl && (
                  <button 
                    onClick={() => onEditStep(resolveEditStep('repo-source', 1))}
                    className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <Pencil className="h-3 w-3" />
                    <span>Edit</span>
                  </button>
                )}`
);

// Mode
content = content.replace(
  `                  <span className="text-sm">\n                    {state.sourceControl.syncPolicy === 'manual' ? 'Manual git sync' : 'Automatic git sync'}\n                  </span>`,
  `                  {onUpdateSourceControl ? (
                    <Select 
                      value={state.sourceControl.syncPolicy || 'auto'} 
                      onValueChange={(val) => onUpdateSourceControl({ syncPolicy: val })}
                    >
                      <SelectTrigger className="w-48 h-8 text-xs bg-black/5 dark:bg-zinc-900 border-0 focus:ring-0 px-3">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="auto">Automatic git sync</SelectItem>
                        <SelectItem value="manual">Manual git sync</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : (
                    <span className="text-sm">
                      {state.sourceControl.syncPolicy === 'manual' ? 'Manual git sync' : 'Automatic git sync'}
                    </span>
                  )}`
);

// Branch
content = content.replace(
  `                    <span \n                      className="text-sm font-mono truncate max-w-[200px] md:max-w-[300px]" \n                      title={state.sourceControl.defaultBranch}\n                    >\n                      {state.sourceControl.defaultBranch}\n                    </span>`,
  `                    {onUpdateSourceControl ? (
                      <Input
                        className="w-48 h-8 text-xs bg-black/5 dark:bg-zinc-900 border-0 focus-visible:ring-0 font-mono px-3"
                        value={state.sourceControl.defaultBranch}
                        onChange={(e) => onUpdateSourceControl({ defaultBranch: e.target.value })}
                      />
                    ) : (
                      <span 
                        className="text-sm font-mono truncate max-w-[200px] md:max-w-[300px]" 
                        title={state.sourceControl.defaultBranch}
                      >
                        {state.sourceControl.defaultBranch}
                      </span>
                    )}`
);

// Workspace
content = content.replace(
  `                  <span className="text-sm">\n                    {state.sourceControl.workingCopyMode === 'attached' ? 'Attached checkout' : 'Managed workspace'}\n                  </span>`,
  `                  {onUpdateSourceControl ? (
                    <Select 
                      value={state.sourceControl.workingCopyMode || 'managed'} 
                      onValueChange={(val) => onUpdateSourceControl({ workingCopyMode: val })}
                    >
                      <SelectTrigger className="w-48 h-8 text-xs bg-black/5 dark:bg-zinc-900 border-0 focus:ring-0 px-3">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="managed">Managed workspace</SelectItem>
                        <SelectItem value="attached">Attached checkout</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : (
                    <span className="text-sm">
                      {state.sourceControl.workingCopyMode === 'attached' ? 'Attached checkout' : 'Managed workspace'}
                    </span>
                  )}`
);

// Setup
content = content.replace(
  `                  <span className="text-sm">\n                    {state.sourceControl.setupMode === 'organization' ? 'Organization' : 'Personal'} setup\n                  </span>`,
  `                  {onUpdateSourceControl ? (
                    <Select 
                      value={state.sourceControl.setupMode || 'personal'} 
                      onValueChange={(val) => onUpdateSourceControl({ setupMode: val })}
                    >
                      <SelectTrigger className="w-48 h-8 text-xs bg-black/5 dark:bg-zinc-900 border-0 focus:ring-0 px-3">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="personal">Personal setup</SelectItem>
                        <SelectItem value="organization">Organization setup</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : (
                    <span className="text-sm">
                      {state.sourceControl.setupMode === 'organization' ? 'Organization' : 'Personal'} setup
                    </span>
                  )}`
);

fs.writeFileSync('src/components/wizard/steps/ReviewStep.tsx', content);

// Now update NewProject.tsx to pass onUpdateSourceControl
let newProj = fs.readFileSync('src/pages/NewProject.tsx', 'utf8');
newProj = newProj.replace(
  "                  editStepIndexById={Object.fromEntries(steps.map((step, index) => [step.id, index]))}",
  "                  editStepIndexById={Object.fromEntries(steps.map((step, index) => [step.id, index]))}\n                  onUpdateSourceControl={updateSourceControl}"
);
fs.writeFileSync('src/pages/NewProject.tsx', newProj);
