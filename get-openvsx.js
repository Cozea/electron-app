const https = require('https');

https.get('https://open-vsx.org/api/swmansion/react-native-ide', (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    try {
      const json = JSON.parse(data);
      console.log('OpenVSX latest:', json.version);
    } catch (e) {
      console.error('Parse error:', e.message);
    }
  });
});
