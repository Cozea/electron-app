import re
import json

with open('/Users/admin/.local/share/kilo/tool-output/tool_d29c52af7001BRlc65AVrnj4pY', 'r', encoding='utf-8') as f:
    text = f.read()

# find exact JWT token format
matches = re.findall(r'eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+', text)
if matches:
    for m in set(matches):
        print(f"JWT Token: {m}")

# Alternatively, search for mcp.json or similar that might contain the token
matches = re.findall(r'"token"\s*:\s*"([^"]+)"', text)
if matches:
    for m in set(matches):
        print(f"\"token\":\"{m}\"")

