const pty = require('node-pty');
const cp = require('child_process');
const token = require('fs').readFileSync(process.env.HOME + '/Library/Application Support/cozea/settings.json', 'utf8').match(/radonToken.*?\"([^\"]+)\"/)?.[1];

const ptyProcess = pty.spawn('./resources/radon/dist/simulator-server-macos', ['ios', '--id', '571DBC5E-01D2-4C67-939C-C620DAC7D085', '-t', token], {
  name: 'xterm-color',
  cols: 80,
  rows: 30,
  cwd: process.cwd(),
  env: process.env
});

ptyProcess.on('data', function(data) {
  process.stdout.write(data);
  const match = data.toString().match(/stream_ready (http:\/\/[^\s\r\n]+)/);
  if (match) {
    console.log('\n!!! Stream Ready! Starting curl in background !!!', match[1]);
    const curl = cp.spawn('curl', ['-N', '-s', match[1]]);
    curl.stdout.on('data', () => process.stdout.write('+'));
    curl.on('exit', c => console.log('Curl exited:', c));
  }
});

setTimeout(() => { ptyProcess.kill(); process.exit(); }, 15000);
