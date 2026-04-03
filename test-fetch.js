const { spawn } = require('child_process');
const http = require('http');

const child = spawn('resources/radon/dist/simulator-server-macos', ['ios', '--id', '571DBC5E-01D2-4C67-939C-C620DAC7D085'], {
  stdio: ['pipe', 'pipe', 'pipe']
});

child.stdout.on('data', d => {
  const str = d.toString();
  console.log('OUT:', str);
  const match = str.match(/stream_ready (http:\/\/[^\s]+)/);
  if (match) {
    console.log('Fetching', match[1]);
    http.get(match[1], res => {
      console.log('Status:', res.statusCode);
      res.on('data', chunk => {
        // Just consume data
      });
    }).on('error', err => console.error('Fetch error:', err.message));
  }
});
child.stderr.on('data', d => console.log('ERR:', d.toString()));
child.on('exit', (code, signal) => console.log('EXIT:', code, signal));

setTimeout(() => child.kill(), 10000);
