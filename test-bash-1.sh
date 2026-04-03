./resources/radon/dist/simulator-server-macos ios --id 571DBC5E-01D2-4C67-939C-C620DAC7D085 < /dev/zero > out.log 2> err.log &
PID=$!
sleep 15
echo "Killing $PID"
kill -9 $PID
cat out.log
cat err.log
