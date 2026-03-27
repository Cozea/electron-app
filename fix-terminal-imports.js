const fs = require('fs');
let file = fs.readFileSync('src/features/projects/components/TerminalInstance.tsx', 'utf8');

file = file.replace("import { Sparkles } from 'lucide-react'", "");
file = file.replace("import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'", "");

const handleContextMenuStart = file.indexOf("const handleContextMenu = useCallback(");
const handleContextMenuEnd = file.indexOf("  const handleAskAIFromSelection = useCallback(() => {");
file = file.substring(0, handleContextMenuStart) + file.substring(handleContextMenuEnd);

const handleAskStart = file.indexOf("const handleAskAIFromSelection = useCallback(() => {");
const handleAskEnd = file.indexOf("}, [getTrimmedSelection, selectedText])", handleAskStart) + 40;
file = file.substring(0, handleAskStart) + file.substring(handleAskEnd);

file = file.replace("const [selectedText, setSelectedText] = useState('')", "");

const selectionDisposableStart = file.indexOf("const selectionDisposable = term.onSelectionChange(() => {");
const selectionDisposableEnd = file.indexOf("})", selectionDisposableStart) + 3;
file = file.substring(0, selectionDisposableStart) + file.substring(selectionDisposableEnd);

// Also remove getTrimmedSelection
const getTrimmedStart = file.indexOf("const getTrimmedSelection = useCallback(() => {");
const getTrimmedEnd = file.indexOf("}, [])", getTrimmedStart) + 6;
file = file.substring(0, getTrimmedStart) + file.substring(getTrimmedEnd);

// The file also had setSelectedText('') in cleanup, remove it
file = file.replace("setSelectedText('')", "");

fs.writeFileSync('src/features/projects/components/TerminalInstance.tsx', file);
