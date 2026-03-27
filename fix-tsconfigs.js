const fs = require('fs');
const configs = ['tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json'];
configs.forEach(configFile => {
  if (fs.existsSync(configFile)) {
    let content = fs.readFileSync(configFile, 'utf8');
    if (!content.includes('@t3tools/contracts')) {
      content = content.replace(
        /"paths": \{/g,
        '"paths": {\n      "@t3tools/contracts": ["./shared/t3-contracts/index.ts"],\n      "@t3tools/contracts/*": ["./shared/t3-contracts/*"],\n      "@t3tools/shared/*": ["./shared/t3-shared/*"],'
      );
      fs.writeFileSync(configFile, content);
    }
  }
});
