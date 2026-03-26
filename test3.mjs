import { spawn } from 'node:child_process';
const child = spawn('resources/radon/dist/simulator-server-macos', ['ios', '--id', '571DBC5E-01D2-4C67-939C-C620DAC7D085'], {
  stdio: ['pipe', 'pipe', 'pipe']
});
child.stderr.on('data', d => process.stderr.write('ERR: ' + d));
child.stdout.on('data', async d => {
  const line = d.toString();
  if (line.includes('stream_ready')) {
     const match = line.match(/(http:\/\/[^ ]*stream\.mjpeg)/);
     if (match) {
        console.log('Fetching', match[1], 'in 2 seconds...');
        setTimeout(async () => {
           console.log('Now fetching...');
           try {
              const res = await fetch(match[1]);
              console.log('Fetch status:', res.status);
              res.body.cancel();
           } catch (e) {
              console.error('Fetch failed:', e);
           }
        }, 2000);
     }
  }
});
setTimeout(() => child.kill(), 8000);
