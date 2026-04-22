const { execSync } = require('child_process');
try {
  execSync('bun run typecheck', { stdio: 'pipe' });
  console.log("No errors");
} catch (e) {
  const err = e.stdout.toString().split('\n').filter(l => l.includes('error TS')).slice(0, 50).join('\n');
  console.log(err);
}
