./resources/radon/dist/simulator-server-macos ios --id 571DBC5E-01D2-4C67-939C-C620DAC7D085 < /dev/zero > out.log 2> err.log &
PID=$!
sleep 5
URL=$(grep -o 'http://127.0.0.1:[0-9]*/stream.mjpeg' out.log)
echo "Fetching $URL"
curl -N -s $URL > /dev/null &
CURL_PID=$!
sleep 15
echo "Killing $PID and curl"
kill -9 $CURL_PID
kill -9 $PID
cat err.log
