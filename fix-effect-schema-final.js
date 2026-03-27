const fs = require('fs');
const glob = require('glob');

const files = glob.sync('shared/t3-contracts/**/*.ts');
for (const file of files) {
  let content = fs.readFileSync(file, 'utf8');

  // Fix Union array syntax: Schema.Union([a, b]) -> Schema.Union(a, b)
  content = content.replace(/Schema\.Union\(\[([\s\S]*?)\]\)/g, 'Schema.Union($1)');
  
  // Fix baseSchemas.ts
  if (file.endsWith('baseSchemas.ts')) {
    content = content.replace(/TrimmedString\.check\(Schema\.isNonEmpty\(\)\)/g, 'Schema.String.pipe(Schema.trim(), Schema.nonEmptyString())');
  }

  // Fix Schema.Literal([...ARRAY_VAR])
  // effect 0.75 doesn't accept arrays in Literal, only varargs. So Schema.Literal(...EDITORS.map(...))
  content = content.replace(/Schema\.Literal\(([A-Za-z0-9_\.]+\.map\([^)]+\))\)/g, 'Schema.Literal(...$1)');

  // Fix keybindings.ts
  if (file.endsWith('keybindings.ts')) {
    content = content.replace(/Schema\.Literal\(\[([\s\S]*?)\]\)/g, 'Schema.Literal($1)');
    content = content.replace(/typeof NonEmptyString\.check/g, 'Schema.decodeUnknownSync(NonEmptyString)');
    content = content.replace(/typeof Trim\.check/g, 'Schema.decodeUnknownSync(Trim)');
    content = content.replace(/Schema\.Array\(([^)]+)\)\.check/g, 'Schema.decodeUnknownSync(Schema.Array($1))');
  }

  fs.writeFileSync(file, content);
}
