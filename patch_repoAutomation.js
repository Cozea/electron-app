const fs = require('fs');

let content = fs.readFileSync('src/lib/git/projectRepoAutomation.ts', 'utf8');

content = content.replace(
  "      accessState: result.accessState,",
  "      accessState: result.accessState || 'error',"
);

fs.writeFileSync('src/lib/git/projectRepoAutomation.ts', content);
