const fs = require('fs');
let file = fs.readFileSync('src/features/projects/components/TerminalInstance.tsx', 'utf8');

const badRef = "  const eventClientPosRef = useRef({ x: 0, y: 0 })";
file = file.replace(badRef, "");

const insertPoint = "  const [initRetry, setInitRetry] = useState(0)";
file = file.replace(insertPoint, insertPoint + "\n  const eventClientPosRef = useRef({ x: 0, y: 0 })");

fs.writeFileSync('src/features/projects/components/TerminalInstance.tsx', file);
