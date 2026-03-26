import { spawn } from 'node:child_process';
import http from 'node:http';

const child = spawn('resources/radon/dist/simulator-server-macos', ['ios', '--id', '571DBC5E-01D2-4C67-939C-C620DAC7D085'], {
  stdio: ['pipe', 'pipe', 'pipe']
});

child.stdout.on('data', d => {
  const str = d.toString();
  console.log('OUT:', str);
  const match = str.match(/stream_ready (http:\/\/[^\s]+)/);
  if (match) {
    const url = match[1];
    console.log('Fetching', url);
    http.get(url, res => {
      console.log('Status:', res.statusCode);
      res.on('data', chunk => process.stdout.write(chunk.length + ' bytes '));
    }).on('error', err => console.error('Fetch error:', err.message));
  }
});

child.stderr.on('data', d => console.error('ERR:', d.toString()));

setTimeout(() => {
  child.kill();
  process.exit();
}, 5000);
