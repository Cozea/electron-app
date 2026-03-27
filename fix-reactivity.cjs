const fs = require('fs');
const glob = require('glob');

const files = glob.sync('electron/t3-server/**/*.ts');
for (const file of files) {
  let content = fs.readFileSync(file, 'utf8');
  content = content.replace(/effect\/unstable\/reactivity\/Reactivity/g, 'effect/Reactivity');
  fs.writeFileSync(file, content);
}
