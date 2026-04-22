const { app, BrowserWindow, WebContentsView } = require('electron')

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 800, height: 600 })
  const view = new WebContentsView()
  win.contentView.addChildView(view)
  view.setBounds({ x: 0, y: 0, width: 800, height: 600 })
  await view.webContents.loadURL('https://google.com')
  try {
    const img = await view.webContents.capturePage(undefined, { stayHidden: true })
    console.log('Capture with undefined success, size:', img.getSize())
  } catch (e) {
    console.error('Capture with undefined failed:', e.message)
  }
  try {
    const img = await view.webContents.capturePage()
    console.log('Capture empty args success, size:', img.getSize())
  } catch (e) {
    console.error('Capture empty args failed:', e.message)
  }
  app.quit()
})
