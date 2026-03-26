const execa = require('execa');
const child = execa('./simulator-server-macos', ['ios', '--id', '571DBC5E-01D2-4C67-939C-C620DAC7D085'], {
  buffer: false,
  quietErrorsOnExit: true,
  cwd: process.cwd() + '/resources/radon/dist'
});

child.stdout.on('data', d => {
  console.log('OUT', d.toString());
});
child.stderr.on('data', d => console.log('ERR', d.toString()));
child.on('exit', (code, signal) => console.log('EXIT:', code, signal));

setTimeout(() => child.kill(), 5000);
