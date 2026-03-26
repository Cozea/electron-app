const fs = require('fs');

let c = fs.readFileSync('server/src/lib/convex.ts', 'utf8');
// remove the lingering syntax error around 750
c = c.replace(/export async function getLatestModelRegistrySnapshotForServer[\s\S]*?\}\s*\}/g, '');
c = c.replace(/export async function updateOrganizationAiSettings[\s\S]*?\}\s*\}/g, '');
c = c.replace(/export async function reserveWalletForServer[\s\S]*?\}\s*\}/g, '');
c = c.replace(/export async function captureWalletHoldForServer[\s\S]*?\}\s*\}/g, '');
c = c.replace(/export async function releaseWalletHoldForServer[\s\S]*?\}\s*\}/g, '');
c = c.replace(/export async function getWalletForServer[\s\S]*?\}\s*\}/g, '');
c = c.replace(/export async function grantIncludedBalanceForServer[\s\S]*?\}\s*\}/g, '');
c = c.replace(/export async function revokeIncludedBalanceForServer[\s\S]*?\}\s*\}/g, '');

// Just fix syntax error 
c = c.replace(/\}\s*\}/g, '}\n');
fs.writeFileSync('server/src/lib/convex.ts', c);

