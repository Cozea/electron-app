const fs = require('fs');

let app = fs.readFileSync('src/App.tsx', 'utf8');
app = app.replace(/import \{ prewarmModelCatalog \} from '\.\/lib\/ai\/modelCatalogClient'/g, '');
app = app.replace(/prewarmModelCatalog\(\)\.catch\(\(error\) =>/g, 'Promise.resolve().catch((error: any) =>');
fs.writeFileSync('src/App.tsx', app);

let dsa = fs.readFileSync('src/features/projects/lib/devServerAiRecovery.ts', 'utf8');
dsa = dsa.replace(/import \{ fetchLocalChat \} from '@\/lib\/ai\/apiEndpoints'/g, '');
fs.writeFileSync('src/features/projects/lib/devServerAiRecovery.ts', dsa);

let sd = fs.readFileSync('src/components/settings/SettingsDrawer.tsx', 'utf8');
sd = sd.replace(/import \{ ModelSelection \} from '@\/pages\/settings\/ModelSelection'/g, 'import ModelSelection from "@/pages/settings/ModelSelection"');
fs.writeFileSync('src/components/settings/SettingsDrawer.tsx', sd);

let rt = fs.readFileSync('src/router/routes.tsx', 'utf8');
rt = rt.replace(/import \{ ModelSelection \} from '@\/pages\/settings\/ModelSelection'/g, 'import ModelSelection from "@/pages/settings/ModelSelection"');
fs.writeFileSync('src/router/routes.tsx', rt);

