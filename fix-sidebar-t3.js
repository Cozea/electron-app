const fs = require('fs');

let file = fs.readFileSync('src/components/terminal/AITerminalSidebar.tsx', 'utf8');

// Update imports
file = file.replace(
  "import { useTerminalActions, useTerminalStore, type TerminalInstance as StoredTerminalInstance } from '@/stores/useTerminalStore'",
  "import { useTerminalActions, useTerminalStore, type TerminalInstance as StoredTerminalInstance } from '@/stores/useTerminalStore'\nimport { ensureNativeApi } from '@/lib/nativeApi'"
);

const launchAITerminalOld = `  const launchAITerminal = useCallback(async (profile: AITerminalProfile) => {
    if (!projectPath) return

    setLaunchingId(profile.id)
    setLaunchError(null)

    try {
      const prepared = await window.electronAPI.agentTools.prepare({ toolId: profile.id })
      if (!prepared.success || !prepared.available) {
        throw new Error(prepared.error || 'Failed to prepare agent CLI')
      }

      const launchCommand = prepared.launchCommand ?? ''

      const result = await window.electronAPI.terminal.create({
        projectPath,
        cwd: projectPath,
        cols: 80,
        rows: 24,
      })

      if (!result.success || !result.terminalId) {
        throw new Error(result.error || 'Failed to create terminal')
      }

      const terminalId = result.terminalId
      const info = await window.electronAPI.terminal.getInfo({ terminalId })
      const createdAt = Date.now()

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
  }, [projectPath, registerTerminal, upsertSession, setActiveSession])`;

const launchAITerminalNew = `  const launchAITerminal = useCallback(async (profile: AITerminalProfile) => {
    if (!projectPath) return

    setLaunchingId(profile.id)
    setLaunchError(null)

    try {
      let terminalId = '';
      let launchCommand = '';

      if (viewMode === 'gui' && profile.supportedModes.includes('gui')) {
        // Use T3 SDK Thread
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
        // Use raw bash terminal
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
        const createdAt = Date.now()

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
        createdAt: Date.now(),
      })
      setIsCreatingNew(false)
      if (projectPath) setActiveSession(projectPath, terminalId)

    } catch (err: any) {
      setLaunchError(err.message || 'An error occurred')
    } finally {
      setLaunchingId(null)
    }
  }, [projectPath, viewMode, registerTerminal, upsertSession, setActiveSession])`;

file = file.replace(launchAITerminalOld, launchAITerminalNew);
fs.writeFileSync('src/components/terminal/AITerminalSidebar.tsx', file);
