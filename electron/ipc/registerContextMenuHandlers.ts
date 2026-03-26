import { BrowserWindow, clipboard, Menu, shell, type IpcMain } from 'electron'
import path from 'node:path'

interface RegisterContextMenuHandlersDeps {
  getMainWindow: () => BrowserWindow | null
}

export function registerContextMenuHandlers(
  ipcMain: IpcMain,
  deps: RegisterContextMenuHandlersDeps
): void {
  ipcMain.handle(
    'contextMenu:showTerminalSelection',
    async (
      _event,
      { selectedText, x, y }: { selectedText: string; x: number; y: number }
    ): Promise<{ action: string | null }> => {
      return new Promise((resolve) => {
        const template: Electron.MenuItemConstructorOptions[] = [
          {
            label: 'Copy',
            accelerator: 'CmdOrCtrl+C',
            click: () => {
              clipboard.writeText(selectedText)
              resolve({ action: 'copy' })
            },
          },
          { type: 'separator' },
          {
            label: 'Ask AI about this',
            click: () => {
              resolve({ action: 'askAI' })
            },
          },
          {
            label: 'Explain this error',
            click: () => {
              resolve({ action: 'explainError' })
            },
          },
          { type: 'separator' },
          {
            label: 'Search Google',
            click: () => {
              const query = encodeURIComponent(selectedText)
              shell.openExternal(`https://www.google.com/search?q=${query}`)
              resolve({ action: 'searchGoogle' })
            },
          },
          {
            label: 'Search Stack Overflow',
            click: () => {
              const query = encodeURIComponent(selectedText)
              shell.openExternal(`https://stackoverflow.com/search?q=${query}`)
              resolve({ action: 'searchStackOverflow' })
            },
          },
        ]

        const menu = Menu.buildFromTemplate(template)

        menu.popup({
          window: deps.getMainWindow() || undefined,
          x,
          y,
          callback: () => {
            resolve({ action: null })
          },
        })
      })
    }
  )

  ipcMain.handle(
    'contextMenu:showFileTreeMenu',
    async (
      event,
      {
        targetPath,
        isDirectory,
        x,
        y,
      }: { targetPath: string; isDirectory: boolean; x: number; y: number }
    ): Promise<{ action: string | null }> => {
      return new Promise((resolve) => {
        let resolved = false
        const window = BrowserWindow.fromWebContents(event.sender) ?? deps.getMainWindow()
        const revealLabel =
          process.platform === 'darwin'
            ? 'Reveal in Finder'
            : process.platform === 'win32'
              ? 'Show in Explorer'
              : 'Show in File Manager'

        const template: Electron.MenuItemConstructorOptions[] = [
          {
            label: 'New File',
            click: () => {
              resolved = true
              resolve({ action: 'new-file' })
            },
          },
          {
            label: 'New Folder',
            click: () => {
              resolved = true
              resolve({ action: 'new-folder' })
            },
          },
          {
            label: 'Rename',
            click: () => {
              resolved = true
              resolve({ action: 'rename' })
            },
          },
          {
            label: 'Duplicate',
            click: () => {
              resolved = true
              resolve({ action: 'duplicate' })
            },
          },
          {
            label: 'Delete',
            click: () => {
              resolved = true
              resolve({ action: 'delete' })
            },
          },
          { type: 'separator' },
          {
            label: revealLabel,
            click: () => {
              shell.showItemInFolder(targetPath)
              resolved = true
              resolve({ action: 'reveal' })
            },
          },
          {
            label: 'Copy Path',
            click: () => {
              clipboard.writeText(targetPath)
              resolved = true
              resolve({ action: 'copy-path' })
            },
          },
          {
            label: 'Copy Relative Path',
            click: () => {
              resolved = true
              resolve({ action: 'copy-relative-path' })
            },
          },
          { type: 'separator' },
          {
            label: isDirectory ? 'Copy Folder Name' : 'Copy File Name',
            click: () => {
              clipboard.writeText(path.basename(targetPath))
              resolved = true
              resolve({ action: 'copy-name' })
            },
          },
        ]

        const menu = Menu.buildFromTemplate(template)

        menu.popup({
          window: window || undefined,
          x,
          y,
          callback: () => {
            if (!resolved) {
              resolve({ action: null })
            }
          },
        })
      })
    }
  )

  ipcMain.handle(
    'contextMenu:showVisualEditorMenu',
    async (
      event,
      { hasReactSource, hasReactStack, x, y }: { hasReactSource: boolean; hasReactStack: boolean; x: number; y: number }
    ): Promise<{ action: string | null }> => {
      return new Promise((resolve) => {
        let resolved = false
        const window = BrowserWindow.fromWebContents(event.sender) ?? deps.getMainWindow()

        const template: Electron.MenuItemConstructorOptions[] = [
          {
            label: 'Ask AI about this element',
            click: () => {
              resolved = true
              resolve({ action: 'ask-ai' })
            },
          },
          {
            label: 'Copy selector',
            click: () => {
              resolved = true
              resolve({ action: 'copy-selector' })
            },
          },
        ]

        if (hasReactSource) {
          template.push({
            label: 'Open source file in editor',
            click: () => {
              resolved = true
              resolve({ action: 'open-source' })
            },
          })
        }

        if (hasReactStack) {
          template.push({
            label: 'Copy React component stack',
            click: () => {
              resolved = true
              resolve({ action: 'copy-stack' })
            },
          })
        }

        const menu = Menu.buildFromTemplate(template)
        menu.popup({
          window: window || undefined,
          x,
          y,
          callback: () => {
            if (!resolved) {
              resolve({ action: null })
            }
          },
        })
      })
    }
  )

  ipcMain.handle(
    'contextMenu:showNativePreviewMenu',
    async (
      event,
      options: {
        x: number
        y: number
        iosDevices: Array<{ id: string; name: string; state: string; isSelected: boolean }>
        androidDevices: Array<{ id: string; name: string; state: string; isSelected: boolean }>
      }
    ) => {
      const window = BrowserWindow.fromWebContents(event.sender) ?? deps.getMainWindow()
      return new Promise((resolve) => {
        let resolved = false
        const template: Electron.MenuItemConstructorOptions[] = []

        // iOS Section
        template.push({ label: 'iOS Simulators', enabled: false })
        if (options.iosDevices.length === 0) {
          template.push({
            label: 'No simulator found',
            click: () => {
              resolved = true
              resolve({ action: 'select-target', target: 'ios' })
            },
          })
        } else {
          for (const device of options.iosDevices) {
            template.push({
              label: `${device.name} - ${device.state.charAt(0).toUpperCase() + device.state.slice(1)}`,
              type: 'checkbox',
              checked: device.isSelected,
              click: () => {
                resolved = true
                resolve({ action: 'select-device', deviceId: device.id, platform: 'ios' })
              },
            })
          }
        }

        template.push({ type: 'separator' })

        // Android Section
        template.push({ label: 'Android Emulators', enabled: false })
        if (options.androidDevices.length === 0) {
          template.push({
            label: 'No emulator found',
            click: () => {
              resolved = true
              resolve({ action: 'select-target', target: 'android' })
            },
          })
        } else {
          for (const device of options.androidDevices) {
            template.push({
              label: `${device.name} - ${device.state.charAt(0).toUpperCase() + device.state.slice(1)}`,
              type: 'checkbox',
              checked: device.isSelected,
              click: () => {
                resolved = true
                resolve({ action: 'select-device', deviceId: device.id, platform: 'android' })
              },
            })
          }
        }

        const menu = Menu.buildFromTemplate(template)
        menu.popup({
          window: window || undefined,
          x: Math.round(options.x),
          y: Math.round(options.y),
          callback: () => {
            if (!resolved) {
              resolve({ action: null })
            }
          },
        })
      })
    }
  )

  ipcMain.handle(
    'contextMenu:showNative',
    async (
      event,
      options: {
        x: number
        y: number
        editable?: boolean
        selectionText?: string
        linkUrl?: string
      }
    ): Promise<{ shown: boolean }> => {
      const window = BrowserWindow.fromWebContents(event.sender) ?? deps.getMainWindow()
      const isEditable = options.editable ?? false
      const hasSelection = Boolean(options.selectionText?.trim())

      const template: Electron.MenuItemConstructorOptions[] = []

      if (options.linkUrl) {
        template.push(
          {
            label: 'Open Link',
            click: () => {
              void shell.openExternal(options.linkUrl!)
            },
          },
          {
            label: 'Copy Link',
            click: () => {
              clipboard.writeText(options.linkUrl!)
            },
          },
          { type: 'separator' }
        )
      }

      if (isEditable) {
        template.push(
          { role: 'undo' },
          { role: 'redo' },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { role: 'selectAll' }
        )
      } else if (hasSelection) {
        template.push({ role: 'copy' })
      }

      if (template.length === 0) {
        return { shown: false }
      }

      const menu = Menu.buildFromTemplate(template)
      menu.popup({
        window: window || undefined,
        x: options.x,
        y: options.y,
      })

      return { shown: true }
    }
  )
}
