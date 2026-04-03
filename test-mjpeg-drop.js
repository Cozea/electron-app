const { spawn } = require('child_process');
const http = require('http');

const child = spawn('resources/radon/dist/simulator-server-macos', ['ios', '--id', '571DBC5E-01D2-4C67-939C-C620DAC7D085'], {
  stdio: ['pipe', 'pipe', 'pipe']
});

child.stdout.on('data', d => {
  const match = d.toString().match(/stream_ready (http:\/\/[^\s]+)/);
  if (match) {
    console.log('Fetching', match[1]);
    const req = http.get(match[1], res => {
      console.log('Status:', res.statusCode);
      // Immediately abort the request!
      setTimeout(() => {
        console.log('Aborting request...');
        req.destroy();
      }, 500);
    });
  }
});
child.on('exit', (code, signal) => console.log('EXIT:', code, signal));
setTimeout(() => child.kill(), 5000);
