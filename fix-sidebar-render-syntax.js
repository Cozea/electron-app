const fs = require('fs');
let file = fs.readFileSync('src/components/terminal/AITerminalSidebar.tsx', 'utf8');

file = file.replace(
  "          })()\n          ) : (",
  "          })()\n           : ("
);

fs.writeFileSync('src/components/terminal/AITerminalSidebar.tsx', file);
