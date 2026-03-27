const fs = require('fs');

function updateLib(file) {
  if (fs.existsSync(file)) {
    let content = fs.readFileSync(file, 'utf8');
    content = content.replace(/"ES2022"/g, '"ES2023"');
    fs.writeFileSync(file, content);
  }
}

updateLib('tsconfig.app.json');
updateLib('tsconfig.node.json');
updateLib('tsconfig.json');
