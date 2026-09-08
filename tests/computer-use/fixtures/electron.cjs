const { app, BrowserWindow } = require('electron')
app.setName('Cozea CU Electron Fixture')
app.whenReady().then(() => {
  const window = new BrowserWindow({ width: 780, height: 620, title: 'Cozea CU Electron Fixture',
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } })
  window.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<!doctype html><meta charset="utf-8">
    <title>Cozea CU Electron Fixture</title><style>body{font:18px system-ui;padding:24px}button,input{font:inherit;margin:12px;padding:8px}</style>
    <button onclick="this.textContent='Clicks: '+(++window.clicks)">Clicks: 0</button>
    <label>Plain input<input value="alpha beta"></label><div contenteditable role="textbox" aria-label="Rich text">Editable fixture</div>
    <div role="region" aria-label="Scroll area" style="height:150px;overflow:auto;border:1px solid"><div style="height:2000px">Scroll this area</div></div>
    <button onclick="document.getElementById('dialog').showModal()">Open dialog</button>
    <dialog id="dialog"><input aria-label="Dialog input"><button onclick="this.parentElement.close()">Close</button></dialog>
    <div draggable="true" ondragstart="event.dataTransfer.setData('text/plain','fixture')">Drag source</div>
    <div style="height:80px;border:1px solid" ondragover="event.preventDefault()" ondrop="event.preventDefault();this.textContent='Dropped'">Drop target</div>
    <script>window.clicks=0;</script>`))
})
app.on('window-all-closed', () => app.quit())
