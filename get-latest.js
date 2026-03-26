const https = require('https');

const postData = JSON.stringify({
  filters: [{
    criteria: [
      { filterType: 7, value: 'swmansion.react-native-ide' }
    ]
  }],
  flags: 0x1
});

const req = https.request({
  hostname: 'marketplace.visualstudio.com',
  path: '/_apis/public/gallery/extensionquery',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Accept': 'application/json;api-version=3.0-preview.1',
    'Content-Length': Buffer.byteLength(postData)
  }
}, (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    try {
      const json = JSON.parse(data);
      const ext = json.results[0].extensions[0];
      const versions = ext.versions.map(v => v.version);
      console.log('Available versions:', versions.slice(0, 10));
    } catch (e) {
      console.error('Parse error:', e.message);
    }
  });
});

req.write(postData);
req.end();
