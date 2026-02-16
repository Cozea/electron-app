import { app, Menu, shell, type MenuItemConstructorOptions } from 'electron'

export function createApplicationMenu() {
    const isMac = process.platform === 'darwin'
    const isReleaseBuild = app.isPackaged

    const template: MenuItemConstructorOptions[] = [
        // { role: 'appMenu' }
        ...(isMac
            ? [
                {
                    label: app.name,
                    submenu: [
                        { role: 'about' },
                        { type: 'separator' },
                        { role: 'services' },
                        { type: 'separator' },
                        { role: 'hide' },
                        { role: 'hideOthers' },
                        { role: 'unhide' },
                        { type: 'separator' },
                        { role: 'quit' },
                    ],
                },
            ]
            : []) as MenuItemConstructorOptions[],
        // { role: 'fileMenu' }
        {
            label: 'File',
            submenu: [
                isMac ? { role: 'close' } : { role: 'quit' },
            ],
        } as MenuItemConstructorOptions,
        // { role: 'editMenu' }
        {
            label: 'Edit',
            submenu: [
                { role: 'undo' },
                { role: 'redo' },
                { type: 'separator' },
                { role: 'cut' },
                { role: 'copy' },
                { role: 'paste' },
                { role: 'selectAll' },
            ],
        } as MenuItemConstructorOptions,
        // { role: 'viewMenu' }
        {
            label: 'View',
            submenu: [
                ...(!isReleaseBuild
                    ? [
                        { role: 'reload' as const },
                        { role: 'forceReload' as const },
                        { role: 'toggleDevTools' as const },
                        { type: 'separator' as const },
                    ]
                    : []),
                { role: 'resetZoom' },
                { role: 'zoomIn' },
                { role: 'zoomOut' },
                { type: 'separator' },
                { role: 'togglefullscreen' },
            ],
        } as MenuItemConstructorOptions,
        // { role: 'windowMenu' }
        {
            label: 'Window',
            submenu: [
                { role: 'minimize' },
                { role: 'zoom' },
                ...(isMac
                    ? [
                        { type: 'separator' },
                        { role: 'front' },
                        { type: 'separator' },
                        { role: 'window' },
                    ]
                    : [{ role: 'close' }]),
            ],
        } as MenuItemConstructorOptions,
        {
            role: 'help',
            submenu: [
                {
                    label: 'Learn More',
                    click: async () => {
                        await shell.openExternal('https://electronjs.org')
                    },
                },
            ],
        } as MenuItemConstructorOptions,
    ]

    const menu = Menu.buildFromTemplate(template)
    Menu.setApplicationMenu(menu)
}
