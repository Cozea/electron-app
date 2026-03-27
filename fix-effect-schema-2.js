const fs = require('fs');
const glob = require('glob');

const files = glob.sync('shared/t3-contracts/**/*.ts');
for (const file of files) {
  let content = fs.readFileSync(file, 'utf8');

  // Fix Literals -> Literal(...VAR)
  // This looks like Schema.Literal(CONST_NAME)
  content = content.replace(/Schema\.Literal\(([A-Z_]+)\)/g, 'Schema.Literal(...$1)');
  
  // Fix isNonEmpty -> nonEmpty()
  content = content.replace(/\.isNonEmpty\(\)/g, '.pipe(Schema.nonEmptyString())'); // Wait, Schema.nonEmptyString() is what we want on a string. Or Schema.nonEmpty() on an array. Let's check what it was called on. It was called on Schema.String or Array.
  // Actually, usually in v0.75 it's `Schema.nonEmptyString()`.
  
  // Fix 'typeof Trim' -> 'Schema.Trim' because in v0.64 they did `const Trim = Schema.String...`
  // Let's replace Schema.Schema.decodeUnknownSync(TrimmedString) -> Schema.decodeUnknownSync(TrimmedString)
  content = content.replace(/Schema\.Schema\./g, 'Schema.');

  // Fix Schema.Int.pipe -> let's just make it Schema.Number
  content = content.replace(/Schema\.Int\.pipe/g, 'Schema.Number.pipe(Schema.int(), ');

  fs.writeFileSync(file, content);
}
