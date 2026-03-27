const fs = require('fs');
const glob = require('glob');

const files = glob.sync('electron/t3-server/**/*.ts');
for (const file of files) {
  let content = fs.readFileSync(file, 'utf8');

  // effect/unstable/sql/SqlClient -> @effect/sql/SqlClient
  content = content.replace(/effect\/unstable\/sql\/SqlClient/g, '@effect/sql/SqlClient');
  content = content.replace(/effect\/unstable\/sql\/SqlConnection/g, '@effect/sql/SqlConnection');
  content = content.replace(/effect\/unstable\/sql\/SqlError/g, '@effect/sql/SqlError');
  content = content.replace(/effect\/unstable\/sql\/Statement/g, '@effect/sql/Statement');

  fs.writeFileSync(file, content);
}

const frontendFiles = glob.sync('shared/t3-contracts/**/*.ts');
for (const file of frontendFiles) {
  let content = fs.readFileSync(file, 'utf8');
  content = content.replace(/effect\/unstable\/sql\/SqlError/g, '@effect/sql/SqlError');
  fs.writeFileSync(file, content);
}

