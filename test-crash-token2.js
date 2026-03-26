const { spawn } = require('child_process');
const token = 'YOUR_ACTUAL_TOKEN_HERE_NOT_NEEDED_FOR_TEST';
const child = spawn('resources/radon/dist/simulator-server-macos', ['ios', '--id', '571DBC5E-01D2-4C67-939C-C620DAC7D085', '-t', 'fake'], {
  stdio: ['pipe', 'pipe', 'pipe']
});
child.on('exit', (code, signal) => console.log('EXIT:', code, signal));
setTimeout(() => child.kill(), 5000);
