const pty = require('node-pty');
const http = require('http');

const ptyProcess = pty.spawn('./resources/radon/dist/simulator-server-macos', ['ios', '--id', '571DBC5E-01D2-4C67-939C-C620DAC7D085'], {
  name: 'xterm-color',
  cols: 80,
  rows: 30,
  cwd: process.cwd(),
  env: process.env
});

ptyProcess.on('data', function(data) {
  process.stdout.write(data);
  const match = data.toString().match(/stream_ready (http:\/\/[^\s\r\n]+)/);
  if (match) {
    console.log('\n!!! Fetching', match[1], '!!!');
    http.get(match[1], res => {
      console.log('Status:', res.statusCode);
      res.on('data', chunk => process.stdout.write('+'));
    });
  }
});

setTimeout(() => { ptyProcess.kill(); process.exit(); }, 8000);
