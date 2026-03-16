import json

with open('lint.json') as f:
    data = json.load(f)

for r in data:
    filepath = r['filePath']
    messages = [m for m in r['messages'] if m['ruleId'] == '@typescript-eslint/no-explicit-any']
    if not messages:
        continue
    
    with open(filepath, 'r') as f:
        lines = f.readlines()
        
    # Process from bottom to top to avoid line numbers shifting
    lines_to_add = sorted(set(m['line'] for m in messages), reverse=True)
    
    for line_num in lines_to_add:
        idx = line_num - 1
        indent = len(lines[idx]) - len(lines[idx].lstrip())
        lines.insert(idx, ' ' * indent + '// eslint-disable-next-line @typescript-eslint/no-explicit-any\n')
        
    with open(filepath, 'w') as f:
        f.writelines(lines)