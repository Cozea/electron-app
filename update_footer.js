const fs = require('fs');

let content = fs.readFileSync('src/components/wizard/steps/ReviewStep.tsx', 'utf8');

// Add imports
if (!content.includes('Database')) {
  content = content.replace(/Check, CircleDashed } from 'lucide-react'/, "Check, CircleDashed, Database, Star } from 'lucide-react'");
}

// Add formatter functions
const formatters = `
function formatSize(bytes?: number): string | null {
  if (typeof bytes !== 'number' || bytes < 0) return null
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return \`\${Number.parseFloat((bytes / Math.pow(k, i)).toFixed(2))} \${sizes[i]}\`
}

function formatNumber(num?: number): string | null {
  if (typeof num !== 'number' || num < 0) return null
  return new Intl.NumberFormat('en-US', { notation: 'compact', compactDisplay: 'short' }).format(num)
}
`;

if (!content.includes('function formatSize')) {
  content = content.replace(/function getCurrentImportStepIndex/, formatters + '\nfunction getCurrentImportStepIndex');
}

// Update Footer Area
const oldFooter = `          {/* Footer Area */}
          <div className="w-full flex justify-center border-t border-border/40 dark:border-zinc-900 bg-background/50 backdrop-blur-sm z-10 px-8 py-6">
            <div className="max-w-5xl w-full flex justify-end items-center">
              {onImport && (`

const newFooter = `          {/* Footer Area */}
          <div className="w-full flex justify-center border-t border-border/40 dark:border-zinc-900 bg-background/50 backdrop-blur-sm z-10 px-8 py-6">
            <div className="max-w-5xl w-full flex justify-between items-center">
              <div className="flex gap-8 text-[11px] font-mono text-muted-foreground uppercase tracking-widest">
                {typeof state.repoSource?.sizeBytes === 'number' && (
                  <div className="flex items-center gap-2"><Database className="w-4 h-4"/> {formatSize(state.repoSource.sizeBytes)}</div>
                )}
                {typeof state.repoSource?.starsCount === 'number' && (
                  <div className="flex items-center gap-2"><Star className="w-4 h-4"/> {formatNumber(state.repoSource.starsCount)} STARS</div>
                )}
              </div>
              
              {onImport && (`

content = content.replace(oldFooter, newFooter);

fs.writeFileSync('src/components/wizard/steps/ReviewStep.tsx', content);
