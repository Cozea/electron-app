const { spawn } = require('child_process');
const http = require('http');

const child = spawn('resources/radon/dist/simulator-server-macos', ['ios', '--id', '571DBC5E-01D2-4C67-939C-C620DAC7D085'], {
  stdio: ['pipe', 'pipe', 'pipe']
});

setInterval(() => {
  try { child.stdin.write('invalid\n'); } catch (e) {}
}, 5);

child.stdout.on('data', d => {
  const match = d.toString().match(/stream_ready (http:\/\/[^\s]+)/);
  if (match) {
    console.log('Fetching', match[1]);
    http.get(match[1], res => {
      console.log('Status:', res.statusCode);
      res.on('data', chunk => process.stdout.write('+'));
    });
  }
});
child.stderr.on('data', d => {});
child.on('exit', (code, signal) => console.log('EXIT:', code, signal));
setTimeout(() => {
  console.log('Done');
  child.kill('SIGKILL');
  process.exit();
}, 8000);
