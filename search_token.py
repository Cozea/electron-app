import re
import json

with open('/Users/admin/.local/share/kilo/tool-output/tool_d29c52af7001BRlc65AVrnj4pY', 'r', encoding='utf-8') as f:
    text = f.read()

tokens = re.findall(r'eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+', text)
if tokens:
    for t in set(tokens):
        print(f"Token: {t}")

print("---")
# Also look for radonToken in the JSON string
matches = re.findall(r'.{0,50}radonToken.{0,200}', text)
for m in set(matches):
    print("Match:", m)

