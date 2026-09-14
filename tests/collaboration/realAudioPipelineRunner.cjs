/**
 * Real Audio Pipeline & WebRTC Voice Integration Test.
 *
 * Runs inside the native Electron binary to test REAL hardware microphone acquisition,
 * Web Audio AnalyserNode frequency processing, track muting/unmuting, and WebRTC
 * peer-to-peer transmission without ANY test doubles, mocks, or placeholders.
 */

const { app, BrowserWindow, session } = require('electron')

app.whenReady().then(async () => {
  // Configure media permissions matching production main.ts
  session.defaultSession.setPermissionRequestHandler((wc, p, cb) => cb(p === 'media' || p === 'display-capture'))
  session.defaultSession.setPermissionCheckHandler((wc, p) => p === 'media' || p === 'display-capture')

  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      autoplayPolicy: 'no-user-gesture-required',
      webSecurity: false,
    },
  })

  await win.loadURL('http://localhost:5183')

  console.log('--- EXECUTING REAL AUDIO & WEBRTC PIPELINE INTEGRATION TEST ---')

  const result = await win.webContents.executeJavaScript(`
    (async () => {
      const report = {
        microphoneAcquired: false,
        audioContextRunning: false,
        liveFrequenciesCaptured: false,
        nonZeroFrequencyCount: 0,
        mutedFrequencySumIsZero: false,
        unmutedFrequencyRestored: false,
        webrtcTrackReceived: false,
        webrtcConnected: false,
        errors: [],
      };

      try {
        // Step 1: Real Hardware Acquisition via getUserMedia
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        const audioTracks = stream.getAudioTracks();
        if (audioTracks.length > 0 && audioTracks[0].readyState === 'live') {
          report.microphoneAcquired = true;
        } else {
          report.errors.push('No live audio track returned by getUserMedia');
        }

        const track = audioTracks[0];

        // Step 2: Web Audio Context Resumption & Real Analyser Node
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        const ctx = new AudioCtx();
        if (ctx.state === 'suspended') {
          await ctx.resume();
        }
        report.audioContextRunning = (ctx.state === 'running');

        const source = ctx.createMediaStreamSource(stream);
        const gainNode = ctx.createGain();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        source.connect(gainNode);
        gainNode.connect(analyser);

        const freqData = new Uint8Array(analyser.frequencyBinCount);

        // Step 3: Read Real Non-Zero Frequency Buffers
        for (let i = 0; i < 15; i++) {
          analyser.getByteFrequencyData(freqData);
          const sum = freqData.reduce((acc, val) => acc + val, 0);
          if (sum > 0) report.nonZeroFrequencyCount++;
          await new Promise((r) => setTimeout(r, 60));
        }
        report.liveFrequenciesCaptured = report.nonZeroFrequencyCount > 0;

        // Step 4: Test Mute (track.enabled = false + gainNode.gain.value = 0)
        track.enabled = false;
        gainNode.gain.setValueAtTime(0, ctx.currentTime);
        // Allow FFT smoothing window to decay to silence
        let mutedSum = 999;
        for (let i = 0; i < 30 && mutedSum > 0; i++) {
          await new Promise((r) => setTimeout(r, 100));
          analyser.getByteFrequencyData(freqData);
          mutedSum = freqData.reduce((acc, val) => acc + val, 0);
        }
        report.mutedSum = mutedSum;
        report.mutedFrequencySumIsZero = (mutedSum === 0);

        // Step 5: Test Unmute (track.enabled = true + gainNode.gain.value = 1)
        track.enabled = true;
        gainNode.gain.setValueAtTime(1, ctx.currentTime);
        await new Promise((r) => setTimeout(r, 200));
        let unmutedSum = 0;
        for (let i = 0; i < 10; i++) {
          analyser.getByteFrequencyData(freqData);
          unmutedSum += freqData.reduce((acc, val) => acc + val, 0);
          await new Promise((r) => setTimeout(r, 50));
        }
        report.unmutedFrequencyRestored = (unmutedSum > 0);

        // Step 6: Real WebRTC PeerConnection Audio Streaming
        const pc1 = new RTCPeerConnection();
        const pc2 = new RTCPeerConnection();

        // Local signaling loop between pc1 and pc2
        pc1.onicecandidate = (e) => { if (e.candidate) pc2.addIceCandidate(e.candidate); };
        pc2.onicecandidate = (e) => { if (e.candidate) pc1.addIceCandidate(e.candidate); };

        let receivedTrackResolve;
        const receivedTrackPromise = new Promise((resolve) => {
          receivedTrackResolve = resolve;
        });

        pc2.ontrack = (event) => {
          if (event.track && event.track.kind === 'audio') {
            report.webrtcTrackReceived = true;
            receivedTrackResolve(event.track);
          }
        };

        // Add real live audio track to pc1
        pc1.addTrack(track, stream);

        // Negotiate SDP
        const offer = await pc1.createOffer();
        await pc1.setLocalDescription(offer);
        await pc2.setRemoteDescription(offer);

        const answer = await pc2.createAnswer();
        await pc2.setLocalDescription(answer);
        await pc1.setRemoteDescription(answer);

        // Await track receipt on pc2
        await Promise.race([
          receivedTrackPromise,
          new Promise((_, reject) => setTimeout(() => reject(new Error('WebRTC ontrack timeout')), 4000)),
        ]);

        // Await connection state
        let attempts = 0;
        while (pc2.connectionState !== 'connected' && attempts < 30) {
          await new Promise((r) => setTimeout(r, 100));
          attempts++;
        }
        report.webrtcConnected = (pc2.connectionState === 'connected' || pc2.iceConnectionState === 'connected' || pc2.iceConnectionState === 'completed');

        // Cleanup
        track.stop();
        await ctx.close();
        pc1.close();
        pc2.close();
      } catch (e) {
        report.errors.push(e.message || String(e));
      }

      return report;
    })()
  `)

  console.log('REAL AUDIO & WEBRTC PIPELINE REPORT:')
  console.log(JSON.stringify(result, null, 2))

  const allPassed =
    result.microphoneAcquired &&
    result.audioContextRunning &&
    result.liveFrequenciesCaptured &&
    result.mutedFrequencySumIsZero &&
    result.unmutedFrequencyRestored &&
    result.webrtcTrackReceived &&
    result.webrtcConnected &&
    result.errors.length === 0

  if (allPassed) {
    console.log('>>> SUCCESS: ALL REAL AUDIO & WEBRTC PIPELINE CHECKS PASSED (ZERO MOCKS) <<<')
    app.exit(0)
  } else {
    console.error('>>> FAILURE: ONE OR MORE AUDIO PIPELINE CHECKS FAILED <<<')
    app.exit(1)
  }
})
