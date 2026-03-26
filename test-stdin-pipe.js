const { spawn } = require('child_process');
const fs = require('fs');

// Test 1: stdin is inherit
const c1 = spawn('resources/radon/dist/simulator-server-macos', ['ios', '--id', '571DBC5E-01D2-4C67-939C-C620DAC7D085'], {
  stdio: ['inherit', 'pipe', 'pipe']
});
c1.on('exit', (code, sig) => console.log('Inherit EXIT:', code, sig));

// Test 2: stdin is pipe
const c2 = spawn('resources/radon/dist/simulator-server-macos', ['ios', '--id', '571DBC5E-01D2-4C67-939C-C620DAC7D085'], {
  stdio: ['pipe', 'pipe', 'pipe']
});
c2.on('exit', (code, sig) => console.log('Pipe EXIT:', code, sig));

setTimeout(() => { c1.kill(); c2.kill(); }, 5000);
