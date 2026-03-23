const fs = require('fs');

let content = fs.readFileSync('src/components/wizard/steps/ReviewStep.tsx', 'utf8');

const oldRepoReviewBodyStart = 'const repoReviewBody = (';
const oldRepoReviewBodyEnd = `  return (
    <div
      className={cn(`;

const repoReviewBodyRegex = /const repoReviewBody = \([\s\S]*?return \(\n    <div\n      className={cn\(/;

const newBody = `const SectionLabel = ({ children }: { children: React.ReactNode }) => (
    <div className="text-[10px] font-semibold tracking-[0.1em] uppercase text-zinc-500 mb-6">
      {children}
    </div>
  )

  const repoReviewBody = (
    <div className="max-w-5xl mx-auto px-8 py-12 flex flex-col h-full min-h-0 overflow-y-auto app-scrollbar">
      <div className="mb-12">
        <div className="flex items-center gap-3 mb-6">
          <div className="scale-125 transform origin-left">
            {getProviderIcon()}
          </div>
          <h1 className="text-3xl font-bold tracking-tight">{repoName}</h1>
        </div>
        <div className="flex items-center gap-3 mb-8">
          {remoteOwnerLogin ? (
            <>
              <Avatar className="w-6 h-6 rounded-full">
                <AvatarImage src={state.repoSource?.ownerAvatarUrl} alt={remoteOwnerLogin} />
                <AvatarFallback className="text-[10px] font-medium">{ownerAvatarFallback}</AvatarFallback>
              </Avatar>
              <span className="text-sm font-medium">{remoteOwnerLogin}</span>
              <span className="text-zinc-700">•</span>
              {state.repoSource?.provider === 'github' || state.repoSource?.provider === 'gitlab' ? (
                  <IntegrationIcon
                    provider={state.repoSource.provider}
                    size="sm"
                    className="h-4 w-4 shrink-0 text-muted-foreground"
                  />
                ) : <Code2 className="h-4 w-4 text-muted-foreground" />}
            </>
          ) : (
             <span className="text-sm font-medium">Local Project</span>
          )}
        </div>
        
        <div className="border-b border-border/40 dark:border-zinc-900 mb-8" />
        
        {!isExternalRemoteImport ? (
          <div className="mb-12">
            <SectionLabel>Stack</SectionLabel>
            {state.repoSource?.detectedStack ? (
              <div className="space-y-4">
                {state.repoSource.detectedStack.framework && (
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2 w-24 shrink-0">
                      <Code2 className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">Framework</span>
                    </div>
                    <span className="text-sm">{state.repoSource.detectedStack.framework}</span>
                  </div>
                )}
                {state.repoSource.detectedStack.styling && (
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2 w-24 shrink-0">
                      <Palette className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">Styling</span>
                    </div>
                    <span className="text-sm">{state.repoSource.detectedStack.styling}</span>
                  </div>
                )}
                {state.repoSource.detectedStack.database && (
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2 w-24 shrink-0">
                      <Server className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">Database</span>
                    </div>
                    <span className="text-sm">{state.repoSource.detectedStack.database}</span>
                  </div>
                )}
                {state.repoSource.detectedStack.testingFramework && (
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2 w-24 shrink-0">
                      <Layers className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">Testing</span>
                    </div>
                    <span className="text-sm">{state.repoSource.detectedStack.testingFramework}</span>
                  </div>
                )}
                {(state.repoSource.detectedStack.pageCount || state.repoSource.detectedStack.componentCount) && (
                  <div className="flex items-center gap-4 pt-1">
                    <div className="flex items-center gap-2 w-24 shrink-0">
                      <Layers className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">Structure</span>
                    </div>
                    <span className="text-sm text-muted-foreground">
                      {state.repoSource.detectedStack.pageCount && (
                        <span>{state.repoSource.detectedStack.pageCount} pages</span>
                      )}
                      {state.repoSource.detectedStack.pageCount && state.repoSource.detectedStack.componentCount && (
                        <span> · </span>
                      )}
                      {state.repoSource.detectedStack.componentCount && (
                        <span>{state.repoSource.detectedStack.componentCount} components</span>
                      )}
                    </span>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No stack detected</p>
            )}
          </div>
        ) : (
          <div className="mb-12">
            <SectionLabel>README</SectionLabel>
            {isLoadingRepositoryReadme ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Loading README excerpt...</span>
              </div>
            ) : repositoryReadmeSnippet ? (
              <p className="text-muted-foreground leading-relaxed text-[15px] max-w-3xl mb-8">
                {repositoryReadmeSnippet}
              </p>
            ) : (
              <p className="text-muted-foreground leading-relaxed text-[15px] max-w-3xl mb-8">
                No README available.
              </p>
            )}
            
            {shouldLoadRepositoryLanguages ? (
              <LanguageSplitBar
                isLoading={isLoadingRepositoryLanguages}
                languages={repositoryLanguages}
              />
            ) : (
              <p className="text-sm text-muted-foreground">Language split unavailable</p>
            )}
          </div>
        )}

        <div className="border-b border-border/40 dark:border-zinc-900 mb-12" />
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-16">
          <div>
            <div className="mb-12">
              <SectionLabel>Source</SectionLabel>
              <div className="flex items-center gap-8">
                <div className="flex items-center gap-2 text-sm text-muted-foreground w-24">
                  <GitBranch className="h-4 w-4" />
                  <span>Branch</span>
                </div>
                {state.repoSource?.branch ? (
                  <span className="text-xs bg-black/5 dark:bg-zinc-900 px-3 py-1 rounded-full font-mono">
                    {state.repoSource.branch}
                  </span>
                ) : (
                  <span className="text-sm text-muted-foreground">N/A</span>
                )}
              </div>
            </div>

            <div>
              <div className="flex justify-between items-center mb-6">
                <div className="text-[10px] font-semibold tracking-[0.1em] uppercase text-zinc-500">
                  Sync
                </div>
                <button 
                  onClick={() => onEditStep(resolveEditStep('source', 2))}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Pencil className="h-3 w-3" />
                  <span>Edit</span>
                </button>
              </div>
              <div className="space-y-4">
                <div className="flex items-center gap-8">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground w-24 shrink-0">
                    <RefreshCw className="h-4 w-4" />
                    <span>Mode</span>
                  </div>
                  <span className="text-sm">
                    {state.sourceControl.syncPolicy === 'manual' ? 'Manual git sync' : 'Automatic git sync'}
                  </span>
                </div>
                {!isExternalRemoteImport && state.sourceControl.defaultBranch ? (
                  <div className="flex items-center gap-8">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground w-24 shrink-0">
                      <GitBranch className="h-4 w-4" />
                      <span>Branch</span>
                    </div>
                    <span className="text-sm font-mono">{state.sourceControl.defaultBranch}</span>
                  </div>
                ) : null}
                <div className="flex items-center gap-8">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground w-24 shrink-0">
                    <Layers className="h-4 w-4" />
                    <span>Workspace</span>
                  </div>
                  <span className="text-sm">
                    {state.sourceControl.workingCopyMode === 'attached' ? 'Attached checkout' : 'Managed workspace'}
                  </span>
                </div>
                <div className="flex items-center gap-8">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground w-24 shrink-0">
                    <Settings2 className="h-4 w-4" />
                    <span>Setup</span>
                  </div>
                  <span className="text-sm">
                    {state.sourceControl.setupMode === 'organization' ? 'Organization' : 'Personal'} setup
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div>
            <div className="flex justify-between items-center mb-6">
              <div className="text-[10px] font-semibold tracking-[0.1em] uppercase text-zinc-500">
                Team
              </div>
              <button 
                onClick={() => onEditStep(resolveEditStep('team', 3))}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <Pencil className="h-3 w-3" />
                <span>Edit</span>
              </button>
            </div>
            
            <div className="space-y-3">
              {state.team.length > 0 ? state.team.map((member) => {
                const initials = member.name
                  ? member.name.split(' ').map((namePart) => namePart[0]).join('').toUpperCase().slice(0, 2)
                  : member.email[0].toUpperCase()

                return (
                  <div key={member.email} className="flex items-center justify-between p-3 border border-border/40 dark:border-outline dark:bg-zinc-900/30 rounded-lg">
                    <div className="flex items-center gap-3">
                      <Avatar className="h-8 w-8">
                        {member.profileImageUrl && (
                          <AvatarImage src={member.profileImageUrl} alt={member.name || member.email} />
                        )}
                        <AvatarFallback className="text-xs bg-muted">
                          {initials}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <div className="text-sm font-medium">
                          {member.name || member.email} 
                          {member.isCurrentUser && (
                            <span className="text-muted-foreground font-normal ml-1">(you)</span>
                          )}
                        </div>
                        <div className="text-[10px] text-muted-foreground uppercase tracking-tighter mt-0.5">
                          {member.role.replace('_', ' ')}
                        </div>
                      </div>
                    </div>
                    <span className="text-[10px] px-2 py-0.5 bg-black/5 dark:bg-zinc-800 rounded uppercase tracking-wider text-muted-foreground">
                      {member.role.replace('_', ' ')}
                    </span>
                  </div>
                )
              }) : (
                <p className="text-sm text-muted-foreground">No team members added</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )

  return (
    <div
      className={cn(
        "w-full h-full",
        className
      )}
    >
      <div className={cn(
        'relative h-full w-full'
      )}>
        <div
          aria-hidden={isImportActive}
          className={cn(
            'h-full w-full overflow-hidden',
            isImportActive && 'pointer-events-none absolute inset-0 opacity-0',
            'transition-opacity duration-150 flex flex-col'
          )}
        >
          <div className="flex-1 overflow-hidden flex flex-col">
            {repoReviewBody}
          </div>

          {/* Footer Area */}
          <div className="w-full flex justify-center border-t border-border/40 dark:border-zinc-900 bg-background/50 backdrop-blur-sm z-10 px-8 py-6">
            <div className="max-w-5xl w-full flex justify-between items-center">
              <div className="flex gap-8 text-[11px] font-mono text-muted-foreground">
                <div className="flex items-center gap-2"><Database className="w-4 h-4"/> 1.24 GB</div>
                <div className="flex items-center gap-2"><History className="w-4 h-4"/> 4,102 COMMITS</div>
                <div className="flex items-center gap-2"><Star className="w-4 h-4"/> 12.5k STARS</div>
              </div>
              
              {onImport && (
                <Button
                  onClick={onImport}
                  disabled={isImportActive && !isImportError}
                  className="bg-black text-white hover:bg-black/90 dark:bg-white dark:text-black dark:hover:bg-zinc-200 transition-colors px-8 py-5 h-auto rounded-full font-bold text-sm flex items-center gap-2 group"
                >
                  {isImportActive && !isImportError ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <>
                      Import Project
                      <Rocket className="h-4 w-4 group-hover:translate-x-1 transition-transform" />
                    </>
                  )}
                </Button>
              )}
            </div>
          </div>
        </div>

        <div
          aria-hidden={!isImportActive}
          className={cn(
            'h-full w-full max-w-5xl mx-auto',
            !isImportActive && 'pointer-events-none absolute inset-0 opacity-0',
            'transition-opacity duration-150 flex flex-col'
          )}
        >
          <div className="flex-1 overflow-y-auto app-scrollbar">
            <ImportProgressSection
              importError={importError}
              importSyncMessage={importSyncMessage}
              importSyncState={importSyncState}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
`

if (!repoReviewBodyRegex.test(content)) {
    console.log("Could not find old content to replace");
} else {
    // Also we need to make sure we replace the entire returned JSX.
    // The regex matches up to `return (\n    <div\n      className={cn(` which means we have to replace the rest of the file too.
    const fileEndRegex = /return \(\n    <div\n      className={cn\([\s\S]*\}\n$/;
    content = content.replace(/const repoReviewBody = \([\s\S]*\}\n$/, newBody);
    fs.writeFileSync('src/components/wizard/steps/ReviewStep.tsx', content);
    console.log("Updated file");
}
