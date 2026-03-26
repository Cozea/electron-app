const { spawn } = require('child_process');
const path = require('path');
const binary = 'resources/radon/dist/simulator-server-macos';
const cwd = path.resolve(path.dirname(binary));

const child = spawn(path.resolve(binary), ['ios', '--id', '571DBC5E-01D2-4C67-939C-C620DAC7D085'], {
  stdio: ['pipe', 'pipe', 'pipe'],
  cwd: cwd
});

child.stdout.on('data', d => console.log('OUT', d.toString()));
child.stderr.on('data', d => console.log('ERR', d.toString()));
child.on('exit', (code, signal) => console.log('EXIT:', code, signal));

setTimeout(() => {
  console.log('Sending close to stdin...');
  child.stdin.end();
}, 5000);
