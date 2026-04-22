const { execSync } = require('child_process');
try {
  execSync('bun run build', { stdio: 'pipe' });
  console.log("Build Success");
} catch (e) {
  const err = e.stdout.toString().split('\n').filter(l => l.includes('Could not resolve')).slice(0, 10).join('\n');
  console.log("Build Error:\n" + err);
}
