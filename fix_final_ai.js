const fs = require('fs');

// App.tsx
let app = fs.readFileSync('src/App.tsx', 'utf8');
app = app.replace(/import \{ prewarmModelCatalog \} from '\.\/lib\/ai\/modelCatalogClient'/g, '');
app = app.replace(/prewarmModelCatalog\(\)\.catch\(\(error\)\s*=>/g, 'Promise.resolve().catch((error: any) =>');
fs.writeFileSync('src/App.tsx', app);

// devServerAiRecovery
let dsa = fs.readFileSync('src/features/projects/lib/devServerAiRecovery.ts', 'utf8');
dsa = dsa.replace(/import \{ fetchLocalChat \} from '@\/lib\/ai\/apiEndpoints'/g, '');
dsa = dsa.replace(/await fetchLocalChat\([^)]*\)/g, 'null');
fs.writeFileSync('src/features/projects/lib/devServerAiRecovery.ts', dsa);

// ProjectBackendStudioPage
let pbsp = fs.readFileSync('src/features/projects/pages/ProjectBackendStudioPage.tsx', 'utf8');
pbsp = pbsp.replace(/import \{ Background, Controls, MiniMap, ReactFlow, Panel \} from 'reactflow'/g, '');
pbsp = pbsp.replace(/import '@\/components\/ai\/canvas'/g, '');
pbsp = pbsp.replace(/import '@\/components\/ai\/controls'/g, '');
pbsp = pbsp.replace(/import \{ CustomNode \} from '@\/components\/ai\/node'/g, '');
pbsp = pbsp.replace(/import '@\/components\/ai\/panel'/g, '');
pbsp = `export function ProjectBackendStudioPage() { return <div>Backend Studio Disabled</div> } export default ProjectBackendStudioPage;`;
fs.writeFileSync('src/features/projects/pages/ProjectBackendStudioPage.tsx', pbsp);

// ModelSelection
let ms = `export function ModelSelectionPage() { return <div>Model Selection Disabled</div> } export default ModelSelectionPage;`;
fs.writeFileSync('src/pages/settings/ModelSelection.tsx', ms);
let msm = `export function WorkspaceModelSelectionPage() { return <div>Model Selection Disabled</div> } export default WorkspaceModelSelectionPage;`;
fs.writeFileSync('src/pages/workspace/AI.tsx', msm); // already disabled

// useProviderAuthResolution
let upa = `export function useProviderAuthResolution() { return { isResolved: true }; }`;
fs.writeFileSync('src/hooks/useProviderAuthResolution.ts', upa);

// useScopedModelSelectionData
let usmd = `export function useScopedModelSelectionData() { return { models: [] }; }`;
fs.writeFileSync('src/hooks/useScopedModelSelectionData.ts', usmd);

// modelSettingsStorage
let mss = `export function getModelSettings() { return null; }`;
fs.writeFileSync('src/lib/modelSettingsStorage.ts', mss);

