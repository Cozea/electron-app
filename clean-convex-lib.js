const fs = require('fs');
let file = fs.readFileSync('server/src/lib/convex.ts', 'utf8');

const toRemove = [
  'export interface UsageLogResult',
  'export interface AgentRunStepForServer',
  'export interface AgentRunForServer',
  'export interface RepoSessionForServer',
  'export interface UsageAggregateInfo',
  'export async function logUsage',
  'export async function appendAgentRunStepForServer',
  'export async function getAgentRunForServer',
  'export async function getRepoSessionForServer',
  'export async function updateOrganizationAiSettings',
  'export async function getOrganizationUsageSummary',
  'export async function getOrganizationUsageAggregates',
  'export async function getOrganizationRecentUsage',
  'export async function syncBuiltinTools',
  'export async function purgeLegacyTools',
  'export async function listEnabledTools',
  'export type ContinuationProvider = string',
  'export interface ContinuationStateInfo',
  'export async function getContinuationStateForServer',
  'export async function upsertContinuationStateForServer',
  'export async function clearContinuationStateForServer',
  'export async function clearConversationContinuationStateForServer',
  'export async function createToolApprovalRequest',
  'export async function resolveToolApprovalRequest'
];

for (const fn of toRemove) {
  let startIndex = file.indexOf(fn);
  if (startIndex === -1) continue;
  
  // Find the end of the block. Most blocks end with "\n}\n" or "\n}\n\n". 
  // Let's use a simpler approach: finding the next "export " or end of file if it's the last one.
  // Wait, that's dangerous if there are nested functions or non-exported things.
  // Let's just find the closing bracket using a stack-like bracket matcher.
  
  const endBracketMatch = (startPos) => {
    let bracketCount = 0;
    let inString = false;
    let stringChar = '';
    let started = false;
    
    for (let i = startPos; i < file.length; i++) {
      const char = file[i];
      if (char === '"' || char === "'" || char === '`') {
        if (!inString) {
          inString = true;
          stringChar = char;
        } else if (stringChar === char && file[i-1] !== '\\') {
          inString = false;
        }
      }
      
      if (!inString) {
        if (char === '{') {
          bracketCount++;
          started = true;
        } else if (char === '}') {
          bracketCount--;
          if (started && bracketCount === 0) {
            return i;
          }
        }
      }
    }
    return -1;
  };

  const findInterfaceEnd = (startPos) => endBracketMatch(startPos);
  
  let removeStart = startIndex;
  // Also grab preceding comments
  let prevCommentStart = file.lastIndexOf('/**', startIndex);
  if (prevCommentStart !== -1 && !file.substring(prevCommentStart, startIndex).includes('export ')) {
    removeStart = prevCommentStart;
  }
  
  let removeEnd = -1;
  if (fn.includes('interface ') || fn.includes('function ') || fn.includes('type ')) {
     if (fn.includes('type ') && !file.substring(startIndex, startIndex + 100).includes('{')) {
         // simple type alias
         removeEnd = file.indexOf('\n', startIndex);
     } else {
         removeEnd = endBracketMatch(startIndex);
     }
  }

  if (removeStart !== -1 && removeEnd !== -1) {
    file = file.substring(0, removeStart) + file.substring(removeEnd + 1);
  }
}

// Special cleanup for the leftover 'type ContinuationProvider' if it wasn't caught
file = file.replace(/export type ContinuationProvider = string[\r\n]*/g, "");

fs.writeFileSync('server/src/lib/convex.ts', file);
