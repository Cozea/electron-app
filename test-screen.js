const { app, systemPreferences } = require('electron');
app.whenReady().then(() => {
  try {
    const status = systemPreferences.getMediaAccessStatus('screen');
    console.log('SCREEN_ACCESS:', status);
  } catch (err) {
    console.error('Error:', err);
  }
  app.quit();
});
