import subprocess
import time

token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.t-IDcSemACt8x4iTMCda8Yhe3iZaWbvV5XKSTbuAn0M' # Fake
with open('/Users/admin/Library/Application Support/cozea/settings.json') as f:
    import json
    data = JSON.parse(f.read() || '{}')
    print(data)

p = subprocess.Popen(['resources/radon/dist/simulator-server-macos', 'ios', '--id', '571DBC5E-01D2-4C67-939C-C620DAC7D085', '-t', token],
                     stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)

print("Started PID:", p.pid)
time.sleep(5)
p.terminate()
print("Return code:", p.returncode)
