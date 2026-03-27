const fs = require('fs');

let content = fs.readFileSync('src/router/routes.tsx', 'utf8');

content = content.replace(/const MemberDetails/g, '// const MemberDetails');
content = content.replace(/const Policies/g, '// const Policies');
content = content.replace(/const WORKSPACE_POLICIES_ROUTE/g, '// const WORKSPACE_POLICIES_ROUTE');

fs.writeFileSync('src/router/routes.tsx', content);
