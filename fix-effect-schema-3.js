const fs = require('fs');
const execSync = require('child_process').execSync;

try {
  execSync('npm run typecheck', { encoding: 'utf8', stdio: 'pipe' });
} catch (e) {
  const output = e.stdout + '\n' + e.stderr;
  const lines = output.split('\n');
  const errors = lines.filter(l => l.includes('error TS'));

  for (const err of errors) {
    // shared/t3-contracts/baseSchemas.ts(4,85): error TS2339: ...
    const match = err.match(/([^:]+)\((\d+),\d+\): error TS/);
    if (!match) continue;
    const file = match[1];
    const lineNum = parseInt(match[2], 10) - 1;
    
    if (fs.existsSync(file)) {
      const lines = fs.readFileSync(file, 'utf8').split('\n');
      let line = lines[lineNum];
      
      // Fix Literals
      if (line.includes('Schema.Literal(')) {
        line = line.replace(/Schema\.Literal\(([A-Z0-9_a-z]+)\)/g, 'Schema.Literal(...$1)');
      }
      
      // Fix string constraints
      line = line.replace(/\.pipe\(Schema\.maxLength\(([^)]+)\)\)/g, '.pipe(Schema.maxLength($1))');
      line = line.replace(/\.isNonEmpty\(\)/g, '.pipe(Schema.nonEmptyString())');
      
      lines[lineNum] = line;
      fs.writeFileSync(file, lines.join('\n'));
    }
  }
}
