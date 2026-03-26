const { app } = require('electron');
console.log('Real App:', app !== undefined);
app.quit();
