const { app, BrowserWindow, WebContentsView, ipcMain } = require('electron')

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 800, height: 600 })
  const view = new WebContentsView()
  win.contentView.addChildView(view)
  view.setBounds({ x: 0, y: 0, width: 800, height: 600 })
  await view.webContents.loadURL('https://google.com')
  
  view.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.alt && input.shift) {
      console.log('Alt+Shift detected in before-input-event!')
    }
  })
})
