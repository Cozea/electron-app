const { spawn } = require('child_process');
const http = require('http');

const child = spawn('resources/radon/dist/simulator-server-macos', ['ios', '--id', '571DBC5E-01D2-4C67-939C-C620DAC7D085'], {
  stdio: ['pipe', 'pipe', 'pipe']
});

child.stdout.on('data', d => {
  const match = d.toString().match(/stream_ready (http:\/\/[^\s]+)/);
  if (match) {
    console.log('Stream ready at:', match[1]);
    const req = http.get(match[1], res => {
      console.log('Connected to stream! Aborting connection in 100ms...');
      setTimeout(() => {
        req.destroy();
      }, 100);
    });
  }
});

child.on('exit', (code, signal) => console.log('EXIT:', code, signal));
