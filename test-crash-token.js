const { spawn } = require('child_process');
const fs = require('fs');
const config = JSON.parse(fs.readFileSync(process.env.HOME + '/Library/Application Support/cozea/config.json', 'utf8') || '{}');
const profile = Object.values(config.profiles || {})[0];
const token = profile?.preferences?.radonToken;
if (!token) { console.error('NO TOKEN'); process.exit(1); }

const child = spawn('resources/radon/dist/simulator-server-macos', ['ios', '--id', '571DBC5E-01D2-4C67-939C-C620DAC7D085', '-t', token], {
  stdio: ['pipe', 'pipe', 'pipe']
});
child.stdout.on('data', d => console.log('OUT', d.toString()));
child.stderr.on('data', d => console.log('ERR', d.toString()));
child.on('exit', (code, signal) => console.log('EXIT:', code, signal));
setTimeout(() => child.kill(), 5000);
