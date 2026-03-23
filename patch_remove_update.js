const fs = require('fs');

let content = fs.readFileSync('src/pages/NewProject.tsx', 'utf8');

content = content.replace(
  "  const createProject = useMutation(api.projects.create)\n  const updateProject = useMutation(api.projects.update)",
  "  const createProject = useMutation(api.projects.create)"
);

fs.writeFileSync('src/pages/NewProject.tsx', content);
