const { spawn } = require('child_process');

const c2 = spawn('resources/radon/dist/simulator-server-macos', ['ios', '--id', '571DBC5E-01D2-4C67-939C-C620DAC7D085'], {
  stdio: ['pipe', 'pipe', 'pipe']
});
c2.on('exit', (code, sig) => console.log('Pipe EXIT with end():', code, sig));

setTimeout(() => {
  console.log('Sending end() and kill()');
  c2.stdin.end();
  c2.kill('SIGTERM');
}, 3000);
