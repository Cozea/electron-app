const { spawn } = require('child_process');

const child = spawn('sh', ['test-curl-stay.sh'], {
  stdio: 'inherit'
});
child.on('exit', (code, signal) => console.log('EXIT:', code, signal));
