const fs = require('fs');
const glob = require('glob');

const files = glob.sync('shared/t3-contracts/**/*.ts');
for (const file of files) {
  let content = fs.readFileSync(file, 'utf8');
  content = content.replace(/ParseResult\.ParseIssue/g, 'ParseResult');
  // I replaced SchemaIssue with ParseResult.ParseIssue.
  // So the import became `import { Schema, ParseResult.ParseIssue } from "effect";`
  // I need to change the import specifically back to `ParseResult`
  content = content.replace(/import \{([^}]*?)ParseResult\.ParseIssue([^}]*?)\} from "effect";/g, 
     'import {$1ParseResult$2} from "effect";'
  );
  // But wait, the previous script replaced EVERYTHING. 
  // Let's just fix it manually where it occurred.
  content = content.replace(/import \{ Option, Schema, ParseResult, Struct \} from "effect";/g, 'import { Option, Schema, ParseResult, Struct } from "effect";');
  fs.writeFileSync(file, content);
}
