./resources/radon/dist/simulator-server-macos ios --id 571DBC5E-01D2-4C67-939C-C620DAC7D085 < mypipe > out.log 2> err.log &
PID=$!
sleep 5
URL=$(grep -o 'http://127.0.0.1:[0-9]*/stream.mjpeg' out.log)
echo "Fetching $URL"
curl -N -s $URL | head -c 1000 > stream.out
cat stream.out | wc -c
sleep 2
echo "Killing $PID"
kill -9 $PID
cat err.log
