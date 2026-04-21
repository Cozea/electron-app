const { app, BrowserWindow, WebContentsView } = require('electron')

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 800, height: 600 })
  const view = new WebContentsView()
  win.contentView.addChildView(view)
  view.setBounds({ x: 100, y: 100, width: 400, height: 400 })
  await view.webContents.loadURL('https://google.com')
})
