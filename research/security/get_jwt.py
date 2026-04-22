import re

with open('/Users/admin/.local/share/kilo/tool-output/tool_d29c52af7001BRlc65AVrnj4pY', 'r', encoding='utf-8') as f:
    text = f.read()

tokens = set()
for m in re.finditer(r'eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+', text):
    tokens.add(m.group(0))

for t in tokens:
    print("Found JWT Token:", t)

