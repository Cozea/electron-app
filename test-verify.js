const { execFile } = require('child_process');
const util = require('util');
const execFileAsync = util.promisify(execFile);
const token = require('fs').readFileSync(process.env.HOME + '/Library/Application Support/cozea/settings.json', 'utf8').match(/radonToken.*?\"([^\"]+)\"/)?.[1];

console.log('Token from settings:', token ? token.substring(0, 10) + '...' : 'NONE');

async function test() {
  try {
    const { stdout, stderr } = await execFileAsync('resources/radon/dist/simulator-server-macos', ['verify_token', token]);
    console.log('Raw Stdout:', JSON.stringify(stdout));
    const normalized = stdout.split('\n').filter(line => line && !line.startsWith('[')).join('\n').trim();
    console.log('Normalized:', JSON.stringify(normalized));
    console.log('Starts with token_valid?', normalized.startsWith('token_valid'));
  } catch (e) {
    console.error('Error:', e.message);
  }
}
test();
