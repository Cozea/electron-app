import subprocess
import time

p = subprocess.Popen(['resources/radon/dist/simulator-server-macos', 'ios', '--id', '571DBC5E-01D2-4C67-939C-C620DAC7D085'],
                     stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)

print("Started PID:", p.pid)
time.sleep(5)
p.terminate()
print("Return code:", p.returncode)
