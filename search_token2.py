import re
import json

with open('/Users/admin/.local/share/kilo/tool-output/tool_d29c52af7001BRlc65AVrnj4pY', 'r', encoding='utf-8') as f:
    text = f.read()

# find all strings that look like a token starting with eyJ
tokens = re.findall(r'eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}', text)
if tokens:
    for t in set(tokens):
        print(f"Token: {t}")

# Check for shorter ones too just in case
tokens_all = re.findall(r'eyJ[A-Za-z0-9_\.-]+', text)
for t in set(tokens_all):
    if len(t) > 30 and t.count('.') >= 1:
        print(f"Potential Token: {t}")

