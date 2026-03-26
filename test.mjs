import { spawn } from 'node:child_process';
const child = spawn('resources/radon/dist/simulator-server-macos', ['ios', '--id', '571DBC5E-01D2-4C67-939C-C620DAC7D085'], {
  stdio: ['pipe', 'pipe', 'pipe']
});
child.stdout.on('data', d => process.stdout.write('OUT: ' + d));
child.stderr.on('data', d => process.stderr.write('ERR: ' + d));
child.on('exit', code => console.log('Exited with code', code));
setTimeout(() => {
  console.log('Timeout, killing');
  child.kill();
}, 10000);
