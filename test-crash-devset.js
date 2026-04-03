const { spawn } = require('child_process');
const os = require('os');
const path = require('path');
const child = spawn('resources/radon/dist/simulator-server-macos', ['ios', '--id', '571DBC5E-01D2-4C67-939C-C620DAC7D085', '--device-set', path.join(os.homedir(), 'Library/Developer/CoreSimulator/Devices')], {
  stdio: ['pipe', 'pipe', 'pipe']
});
child.stdout.on('data', d => console.log('OUT', d.toString()));
child.stderr.on('data', d => console.log('ERR', d.toString()));
child.on('exit', (code, signal) => console.log('EXIT:', code, signal));
setTimeout(() => child.kill(), 5000);
