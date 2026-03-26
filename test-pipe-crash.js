const { spawn } = require('child_process');
const http = require('http');

// Wait... in `test-curl-stay.sh`, the process DID NOT CRASH!! It actually successfully stayed alive for 15 seconds!!
// But when I use Node.js `spawn` with stdio `pipe`, it crashes every time an HTTP connection opens?!
// What is the difference between my bash script and my node script?
// STDIN!
const child = spawn('resources/radon/dist/simulator-server-macos', ['ios', '--id', '571DBC5E-01D2-4C67-939C-C620DAC7D085'], {
  stdio: ['ignore', 'pipe', 'pipe'] // When bash runs it in the bg, stdin is /dev/null by default unless redirected! Wait, I redirected it to /dev/zero in the bash script. Let's try /dev/zero in node!
});

const fs = require('fs');
const fd = fs.openSync('/dev/zero', 'r');

const child2 = spawn('resources/radon/dist/simulator-server-macos', ['ios', '--id', '571DBC5E-01D2-4C67-939C-C620DAC7D085'], {
  stdio: [fd, 'pipe', 'pipe']
});

child2.stdout.on('data', d => {
  const match = d.toString().match(/stream_ready (http:\/\/[^\s]+)/);
  if (match) {
    const url = match[1];
    console.log('Stream ready!', url);
    const req = http.get(url, res => {
      console.log('Connected! Reading data...');
      res.on('data', chunk => {}); 
      res.on('error', e => console.error('Response error:', e));
    });
    req.on('error', e => console.error('Request error:', e));
  }
});
child2.on('exit', (code, signal) => console.log('EXIT:', code, signal));
setTimeout(() => child2.kill(), 10000);
