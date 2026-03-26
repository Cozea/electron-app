const { spawn } = require('child_process');
const child = spawn('resources/radon/dist/simulator-server-macos', ['ios', '--id', '571DBC5E-01D2-4C67-939C-C620DAC7D085'], {
  stdio: ['pipe', 'pipe', 'pipe']
});
child.stdout.on('data', d => console.log('OUT', d.toString()));
child.stderr.on('data', d => console.log('ERR', d.toString()));
child.on('exit', (code, signal) => console.log('EXIT:', code, signal));
const i = setInterval(() => {
  child.stdin.write('\0');
}, 100);
setTimeout(() => { clearInterval(i); child.kill(); }, 5000);
