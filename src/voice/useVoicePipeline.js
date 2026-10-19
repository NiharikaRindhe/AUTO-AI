import { useCallback, useEffect, useRef, useState } from 'react';
import { openConversation } from './conversation.js';

async function api(path, options = {}) {
  let response;
  try { response = await fetch(`/api/voice/${path}`, options); }
  catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new Error('The local voice backend is unavailable. Start it with npm run dev:all.');
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.detail?.message || 'The local voice request failed. Check the backend and try again.');
  }
  return response;
}

function pause(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    const aborted = () => { clearTimeout(timer); reject(new DOMException('Cancelled', 'AbortError')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', aborted); resolve(); }, milliseconds);
    if (signal.aborted) aborted();
    else signal.addEventListener('abort', aborted, { once: true });
  });
}

export function useVoicePipeline({ onTranscript, onBeforeCapture, onError }) {
  const [health, setHealth] = useState(null);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const [level, setLevel] = useState(0);
  const [probability, setProbability] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const [microphoneActive, setMicrophoneActive] = useState(false);
  const [interrupted, setInterrupted] = useState(false);
  const [language, setLanguage] = useState('en');
  const [lastTranscript, setLastTranscript] = useState('');
  const [recordingUrl, setRecordingUrl] = useState('');
  const [replyUrl, setReplyUrl] = useState('');
  const [timing, setTiming] = useState(null);
  const session = useRef({ id: 0, controller: null, capture: null, active: false });
  const turn = useRef({ id: 0, controller: null, player: null, phase: 'idle' });
  const callbacks = useRef({ onTranscript, onBeforeCapture, onError });
  callbacks.current = { onTranscript, onBeforeCapture, onError };
  const urls = useRef({ recording: '', reply: '' });
  const mounted = useRef(true);
  const phase = useCallback(next => {
    turn.current.phase = next;
    if (mounted.current) setStatus(next);
  }, []);
  const invalidateTurn = useCallback(() => {
    turn.current.id++;
    turn.current.controller?.abort();
    turn.current.controller = null;
    if (turn.current.player) {
      turn.current.player.onended = null;
      turn.current.player.onerror = null;
      turn.current.player.pause();
      turn.current.player = null;
    }
  }, []);
  const cancel = useCallback(() => {
    session.current.id++;
    session.current.active = false;
    session.current.controller?.abort();
    session.current.capture?.cancel();
    session.current.capture = null;
    invalidateTurn();
    if (mounted.current) { phase('idle'); setMicrophoneActive(false); setLevel(0); setProbability(0); setSeconds(0); setInterrupted(false); }
  }, [invalidateTurn, phase]);
  const report = useCallback(issue => {
    if (!mounted.current || issue.name === 'AbortError') return;
    const message = issue.name === 'NotAllowedError' ? 'Microphone access was denied. Allow it in your browser, then try again.' : issue.message || 'Voice processing failed. Please try again.';
    setError(message); phase('error');
    callbacks.current.onError?.(message);
  }, [phase]);
  const replaceUrl = useCallback((key, blob) => {
    if (urls.current[key]) URL.revokeObjectURL(urls.current[key]);
    urls.current[key] = URL.createObjectURL(blob);
    (key === 'recording' ? setRecordingUrl : setReplyUrl)(urls.current[key]);
    return urls.current[key];
  }, []);
  const refreshHealth = useCallback(async signal => {
    try {
      const response = await api('health', { signal });
      const next = await response.json();
      if (mounted.current) setHealth(next);
      return next;
    } catch (issue) {
      if (issue.name !== 'AbortError' && mounted.current) setHealth({ ready: false, unavailable: true, missing: [] });
      return null;
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    void refreshHealth(controller.signal);
    const timer = setInterval(() => { void refreshHealth(controller.signal); }, 30000);
    return () => {
      mounted.current = false; clearInterval(timer); controller.abort(); cancel();
      Object.values(urls.current).filter(Boolean).forEach(URL.revokeObjectURL);
    };
  }, [cancel, refreshHealth]);

  function isCurrent(id) { return mounted.current && turn.current.id === id; }
  function settle() { phase(session.current.active ? 'waiting' : 'idle'); }
  async function waitForEngine(signal) {
    for (let attempt = 0; attempt < 20; attempt++) {
      const response = await api('health', { signal });
      const state = await response.json();
      if (!state.busy) return;
      await pause(100, signal);
    }
    throw new Error('The previous voice request is still stopping. Please try again.');
  }

  async function synthesize(text, id, signal) {
    phase('synthesizing');
    await waitForEngine(signal);
    const response = await api('synthesize', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: text.slice(0, 1600) }), signal });
    const blob = await response.blob();
    if (!isCurrent(id)) return;
    const player = new Audio(replaceUrl('reply', blob));
    turn.current.player = player;
    player.onended = () => { if (isCurrent(id)) { turn.current.player = null; settle(); } };
    player.onerror = () => { if (isCurrent(id)) { cancel(); report(new Error('Could not play the reply. Try the audio controls below.')); } };
    phase('speaking');
    try { await player.play(); }
    catch { if (isCurrent(id)) { cancel(); report(new Error('Your browser paused playback. Press play on the spoken reply below.')); } }
  }

  async function processAudio(recording, id, controller) {
    if (!isCurrent(id)) return;
    replaceUrl('recording', recording.blob);
    phase('transcribing');
    try {
      await waitForEngine(controller.signal);
      const response = await api(`transcribe?language=${encodeURIComponent(language)}`, { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: recording.blob, signal: controller.signal });
      const result = await response.json();
      if (!isCurrent(id)) return;
      setLastTranscript(result.text); setTiming(result.processing_ms); phase('thinking');
      const reply = await callbacks.current.onTranscript(result.text, { signal: controller.signal });
      if (!isCurrent(id)) return;
      if (!reply?.text) { settle(); return; }
      await synthesize(reply.text, id, controller.signal);
    } catch (issue) {
      if (isCurrent(id) && issue.name !== 'AbortError') {
        setError(issue.message); callbacks.current.onError?.(issue.message); settle();
      }
    }
  }

  async function start() {
    cancel(); setError(''); setTiming(null); phase('opening');
    const sessionId = session.current.id;
    const controller = new AbortController(); session.current.controller = controller;
    const ready = await refreshHealth(controller.signal);
    if (session.current.id !== sessionId || !mounted.current) return;
    if (!ready?.ready || !ready?.vad?.ready) {
      report(new Error(ready?.unavailable || !ready ? 'Start the local backend with npm run dev:all.' : 'Voice or Silero setup is incomplete. Run npm run voice:setup and restart the backend.'));
      return;
    }
    callbacks.current.onBeforeCapture?.();
    try {
      const capture = await openConversation({
        signal: controller.signal,
        onLevel: value => { if (session.current.id === sessionId && mounted.current) setLevel(value); },
        onProbability: value => { if (session.current.id === sessionId && mounted.current) setProbability(value); },
        onDuration: value => { if (session.current.id === sessionId && mounted.current) setSeconds(value); },
        isAssistantSpeaking: () => turn.current.phase === 'speaking',
        onSpeechStart: ({ interruption }) => {
          if (session.current.id !== sessionId || !mounted.current) return;
          invalidateTurn(); turn.current.controller = new AbortController();
          setError(''); setInterrupted(interruption); setTiming(null); phase('listening');
        },
        onUtterance: recording => {
          if (session.current.id !== sessionId || !mounted.current) return;
          const turnController = turn.current.controller || new AbortController();
          turn.current.controller = turnController;
          void processAudio(recording, turn.current.id, turnController);
        },
        onError: issue => { if (session.current.id === sessionId) { cancel(); report(issue); } },
      });
      if (session.current.id !== sessionId || !mounted.current) { capture.cancel(); return; }
      session.current.capture = capture; session.current.active = true;
      setMicrophoneActive(true); phase('waiting');
    } catch (issue) { if (session.current.id === sessionId) { cancel(); report(issue); } }
  }

  function toggle() {
    if (status === 'listening') return session.current.capture?.finish();
    if (session.current.active || status === 'opening') return cancel();
    return start();
  }
  function stopReply() {
    invalidateTurn(); session.current.capture?.reset(); setInterrupted(false); settle();
  }
  async function speak(text) {
    invalidateTurn(); session.current.capture?.reset(); setError(''); setInterrupted(false);
    const id = turn.current.id;
    const controller = new AbortController(); turn.current.controller = controller;
    try { await synthesize(text, id, controller.signal); }
    catch (issue) { if (isCurrent(id)) { cancel(); report(issue); } }
  }

  return { health, status, error, level, probability, seconds, microphoneActive, interrupted, language, setLanguage, lastTranscript, recordingUrl, replyUrl, timing, toggle, cancel, stopReply, speak, refreshHealth, busy: !['idle', 'waiting', 'error'].includes(status) };
}
