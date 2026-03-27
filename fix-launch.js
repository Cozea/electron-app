const fs = require('fs');

let file = fs.readFileSync('src/components/terminal/AITerminalSidebar.tsx', 'utf8');

const startIdx = file.indexOf('  const launchAITerminal = useCallback(async (profile: AITerminalProfile) => {');
const endIdx = file.indexOf('  }, [projectPath, registerTerminal, upsertSession, setActiveSession, setLaunchingId, setLaunchError])');
let closingBrace = endIdx + '  }, [projectPath, registerTerminal, upsertSession, setActiveSession, setLaunchingId, setLaunchError])'.length;

if (endIdx === -1) {
  // try different dependency array
  const altEndIdx = file.indexOf('  }, [projectPath, registerTerminal, upsertSession, setActiveSession])');
  if (altEndIdx !== -1) {
    closingBrace = altEndIdx + '  }, [projectPath, registerTerminal, upsertSession, setActiveSession])'.length;
  }
}

if (startIdx !== -1 && closingBrace > startIdx) {
  const newLaunch = `  const launchAITerminal = useCallback(async (profile: AITerminalProfile) => {
    if (!projectPath) return

    setLaunchingId(profile.id)
    setLaunchError(null)

    try {
      let terminalId = '';
      let launchCommand = '';
      const createdAt = Date.now();

      if (viewMode === 'gui' && profile.supportedModes.includes('gui')) {
        const api = ensureNativeApi();
        const thread = await api.server.createThread({
           projectId: projectPath,
           title: \`\${profile.name} Session\`,
           runtimeMode: 'full-access',
           interactionMode: 'default'
        });
        terminalId = thread.id;
        launchCommand = 'SDK Thread';
      } else {
        const prepared = await window.electronAPI.agentTools.prepare({ toolId: profile.id })
        if (!prepared.success || !prepared.available) {
          throw new Error(prepared.error || 'Failed to prepare agent CLI')
        }
        launchCommand = prepared.launchCommand ?? ''
        const result = await window.electronAPI.terminal.create({
          projectPath,
          cwd: projectPath,
          cols: 80,
          rows: 24,
        })
        if (!result.success || !result.terminalId) {
          throw new Error(result.error || 'Failed to create terminal')
        }
        terminalId = result.terminalId;
        const info = await window.electronAPI.terminal.getInfo({ terminalId })

        registerTerminal({
          id: terminalId,
          profileId: info?.profileId ?? 'default',
          profileName: info?.profileName ?? 'Shell',
          title: profile.name,
          label: profile.name,
          kind: 'agent',
          surface: 'assistant',
          agentProfileId: profile.id,
          agentProfileName: profile.name,
          nameSource: 'manual',
          command: launchCommand,
          createdAt,
        })

        if (launchCommand) {
          void window.electronAPI.terminal.input({
            terminalId,
            data: launchCommand + '\\n',
          })
        }
      }

      upsertSession(projectPath, {
        terminalId,
        profileId: profile.id,
        profileName: profile.name,
        label: profile.name,
        command: launchCommand,
        createdAt,
      })
      setIsCreatingNew(false)
      if (projectPath) setActiveSession(projectPath, terminalId)

    } catch (err: any) {
      setLaunchError(err.message || 'An error occurred')
    } finally {
      setLaunchingId(null)
    }
  }, [projectPath, viewMode, registerTerminal, upsertSession, setActiveSession])`;

  file = file.substring(0, startIdx) + newLaunch + file.substring(closingBrace);
  fs.writeFileSync('src/components/terminal/AITerminalSidebar.tsx', file);
} else {
  console.log('Failed to find launchAITerminal indices', startIdx, endIdx);
}
