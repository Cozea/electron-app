const { spawn } = require('child_process');
const child = spawn('resources/radon/dist/simulator-server-macos', ['ios', '--id', '571DBC5E-01D2-4C67-939C-C620DAC7D085'], {
  stdio: ['pipe', 'pipe', 'pipe']
});
child.stdout.on('data', d => process.stdout.write('OUT: ' + d));
child.stderr.on('data', d => process.stderr.write('ERR: ' + d));
child.on('exit', (code, signal) => console.log('EXIT-2:', code, signal));
setTimeout(() => child.stdin.write('invalid_cmd\n'), 2000);
setTimeout(() => child.kill(), 5000);
