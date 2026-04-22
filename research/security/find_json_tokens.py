import re
import json
import base64

with open('/Users/admin/.local/share/kilo/tool-output/tool_d29c52af7001BRlc65AVrnj4pY', 'r', encoding='utf-8') as f:
    text = f.read()

# find all strings starting with eyJ and ending with quotation mark
matches = re.findall(r'eyJ[a-zA-Z0-9+/=]+', text)
for m in set(matches):
    if len(m) > 100:
        try:
            # Add padding if needed
            pad = len(m) % 4
            if pad:
                b64 = m + '=' * (4 - pad)
            else:
                b64 = m
            decoded = base64.b64decode(b64).decode('utf-8', errors='ignore')
            print(f"Token length: {len(m)}")
            print(f"Decoded starts with: {decoded[:100]}")
            print(f"Raw: {m[:50]}...{m[-50:]}")
            print("---")
        except Exception as e:
            pass
