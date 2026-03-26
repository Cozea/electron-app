const { spawn } = require('child_process');
const child = spawn('resources/radon/dist/simulator-server-macos', ['ios', '--id', '571DBC5E-01D2-4C67-939C-C620DAC7D085'], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { PATH: process.env.PATH, HOME: process.env.HOME }
});
child.stdout.on('data', d => console.log('OUT', d.toString()));
child.stderr.on('data', d => console.log('ERR', d.toString()));
child.on('exit', (code, signal) => console.log('EXIT:', code, signal));
setTimeout(() => child.kill(), 5000);
