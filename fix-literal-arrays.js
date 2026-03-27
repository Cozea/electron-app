const fs = require('fs');
const glob = require('glob');

const files = glob.sync('shared/t3-contracts/**/*.ts');
for (const file of files) {
  let content = fs.readFileSync(file, 'utf8');

  // Replace Schema.Literal(["a", "b", "c"]) with Schema.Literal("a", "b", "c")
  content = content.replace(/Schema\.Literal\(\[([\s\S]*?)\]\)/g, 'Schema.Literal($1)');

  fs.writeFileSync(file, content);
}
