const { spawn } = require('child_process');
const child = spawn('arch', ['-arm64', 'resources/radon/dist/simulator-server-macos', 'ios', '--help']);
child.stdout.on('data', d => console.log('OUT', d.toString()));
