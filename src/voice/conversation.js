import { encodeWav } from './audio.js';
import { SpeechTurnDetector } from './turnDetector.js';

// One user-started microphone stream stays open through replies. End closes it.
export async function openConversation({ signal, onLevel, onProbability, onSpeechStart, onUtterance, onDuration, onError, isAssistantSpeaking }) {
  if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
  if (!navigator.mediaDevices?.getUserMedia || !window.AudioContext || !window.AudioWorkletNode || !window.WebSocket) {
    throw new Error('Live voice needs a supported browser on localhost or HTTPS.');
  }
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(`${protocol}//${window.location.host}/api/voice/vad`);
  let stream, context, source, node, sink, watchdog;
  let closed = false, started = false, cleaned = false, lastResponse = Date.now();
  let resolveReady, rejectReady;
  const pending = [];
  const detector = new SpeechTurnDetector({
    onStart: onSpeechStart,
    onDuration,
    onEnd: turn => onUtterance({ blob: encodeWav(turn.chunks, 16000), seconds: turn.seconds, reason: turn.reason }),
  });
  async function cleanup() {
    if (cleaned) return;
    cleaned = true;
    signal?.removeEventListener('abort', abort);
    clearInterval(watchdog);
    detector.reset(); pending.length = 0;
    stream?.getTracks().forEach(track => { track.onended = null; track.stop(); });
    if (node) { node.port.onmessage = null; node.disconnect(); }
    source?.disconnect(); sink?.disconnect();
    socket.onclose = null; socket.onmessage = null; socket.onerror = null;
    if (socket.readyState < WebSocket.CLOSING) socket.close();
    if (context && context.state !== 'closed') await context.close().catch(() => {});
    onLevel(0); onProbability(0);
  }
  function abort() {
    if (closed) return;
    closed = true;
    rejectReady?.(new DOMException('Cancelled', 'AbortError'));
    void cleanup();
  }
  function fail(error) {
    if (closed) return;
    closed = true;
    rejectReady?.(error);
    void cleanup();
    if (started) onError(error);
  }
  try {
    signal?.addEventListener('abort', abort, { once: true });
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { fail(new Error('The local speech detector did not connect. Start npm run dev:all.')); }, 10000);
      resolveReady = () => { clearTimeout(timeout); resolve(); };
      rejectReady = error => { clearTimeout(timeout); reject(error); };
      socket.onerror = () => fail(new Error('The local Silero connection failed. Check the voice backend.'));
      socket.onclose = () => fail(new Error('The local speech detector disconnected. Your microphone has been stopped.'));
      socket.onmessage = ({ data }) => {
        if (closed) return;
        try {
          const message = JSON.parse(data);
          if (message.type === 'ready') { resolveReady(); return; }
          if (message.type === 'error') throw new Error(message.message);
          if (message.type !== 'vad') return;
          lastResponse = Date.now();
          const samples = pending.shift();
          if (!samples) throw new Error('Speech detector audio became out of sync. Please restart the conversation.');
          onProbability(Math.max(...message.probabilities));
          detector.push(samples, message.probabilities, { assistantSpeaking: isAssistantSpeaking() });
        } catch (error) { fail(error); }
      };
    });
    if (closed || signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    // A permission prompt cannot be aborted. Release a stream granted after Stop.
    if (closed || signal?.aborted) { stream.getTracks().forEach(track=>track.stop()); throw new DOMException('Cancelled', 'AbortError'); }
    context = new AudioContext({ sampleRate: 16000 });
    await context.resume();
    if (closed || signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    if (context.sampleRate !== 16000) throw new Error('This browser could not open a 16 kHz microphone stream.');
    await context.audioWorklet.addModule('/pcm-worklet.js');
    if (closed || signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    source = context.createMediaStreamSource(stream);
    node = new AudioWorkletNode(context, 'autoai-pcm-recorder');
    sink = context.createGain(); sink.gain.value = 0;
    node.port.onmessage = ({ data }) => {
      if (closed || data.type !== 'samples') return;
      const samples = data.samples;
      let energy = 0;
      for (const sample of samples) energy += sample * sample;
      onLevel(Math.min(1, Math.sqrt(energy / samples.length) * 9)); // Display only, not VAD.
      if (socket.readyState !== WebSocket.OPEN || pending.length >= 24 || socket.bufferedAmount > 262144) {
        fail(new Error('Live speech processing fell behind. Your microphone has been stopped. Please try again.'));
        return;
      }
      pending.push(samples);
      socket.send(samples.buffer);
    };
    source.connect(node); node.connect(sink); sink.connect(context.destination);
    stream.getAudioTracks()[0].onended = () => fail(new Error('Microphone disconnected. Please restart the conversation.'));
    watchdog = setInterval(() => { if (pending.length && Date.now() - lastResponse > 5000) fail(new Error('Speech detection stopped responding. Please restart the conversation.')); }, 1000);
    started = true;
    return { cancel: abort, finish: () => detector.finish(), reset: () => detector.reset() };
  } catch (error) {
    closed = true;
    await cleanup();
    throw error;
  }
}
