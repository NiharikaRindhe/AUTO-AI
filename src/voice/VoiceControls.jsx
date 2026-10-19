import React from 'react';
import { Mic, MicOff, RefreshCw, Volume2, ShieldCheck, AudioLines, Sparkles } from 'lucide-react';

export const statusLabels = {
  idle: 'Ready when you are', waiting: 'I’m listening. Take your time.', opening: 'Opening your microphone', listening: 'Listening to you',
  transcribing: 'Turning your voice into words', thinking: 'Finding your answer',
  synthesizing: 'Preparing your spoken reply', speaking: 'Speaking your answer', error: 'Let’s try that again',
};

export default function VoiceControls({ voice }) {
  const listening = voice.status === 'listening';
  const speaking = voice.status === 'speaking';
  const ready = voice.health?.ready;
  const vadReady = voice.health?.vad?.ready;
  const buttonLabel = listening ? 'Finish & reply' : voice.microphoneActive ? 'End conversation' : voice.status === 'opening' ? 'Cancel opening' : 'Start conversation';
  return <section className="panel voice-controls">
    <div className="section-label"><span><Mic size={15}/> OFFLINE VOICE</span><button className="icon-button" aria-label="Refresh voice connection" onClick={()=>void voice.refreshHealth()}><RefreshCw size={14}/></button></div>
    <div className={`voice-connection ${ready&&vadReady?'connected':''}`}><span className="status-dot"/>{voice.health === null ? 'Checking local backend…' : ready&&vadReady ? 'Silero + Whisper + Piper connected' : voice.health?.unavailable ? 'Local backend not running' : 'Voice models need setup'}</div>
    <div className={`conversation-stage ${voice.status}`}>
      <div className="conversation-halo"/>
      <div className="conversation-core">{speaking?<AudioLines size={27}/>:voice.busy&&!listening?<Sparkles size={24}/>:<Mic size={25}/>}</div>
      <span className="conversation-stage-label">{speaking?'YOUR CO-PILOT':listening?'YOUR VOICE':voice.microphoneActive?'CONVERSATION IS ON':'A MOMENT TO CONNECT'}</span>
    </div>
    <h3 aria-live="polite">{statusLabels[voice.status]}</h3>
    <p className="muted">{speaking&&voice.microphoneActive?'You can interrupt me by speaking. I’ll pause and listen.':voice.microphoneActive?'Speak naturally, then pause. Your next turn starts automatically.':'Start once, then speak naturally. End the conversation to switch your microphone off.'}</p>
    {voice.interrupted&&listening&&<div className="interruption-note"><AudioLines size={14}/> You interrupted — I’m listening.</div>}
    <label className="voice-language">Input language<select aria-label="Voice input language" value={voice.language} disabled={voice.busy||voice.microphoneActive} onChange={event=>voice.setLanguage(event.target.value)}><option value="en">English</option><option value="hi">Hindi</option><option value="auto">Auto-detect</option></select></label>
    <div className={`voice-meter ${voice.microphoneActive?'active':''} ${speaking?'reply-wave':''}`} role="meter" aria-label="Microphone level" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(voice.level*100)}>
      {Array.from({length:27},(_,index)=><span key={index} style={{height:`${6+voice.level*34*(.5+.5*Math.cos(index*.8))}px`,animationDelay:`${index*.055}s`}}/>)}
      <time>{listening?`${voice.seconds.toFixed(1)}s`:speaking?'Speaking':voice.microphoneActive?'Listening':'Mic off'}</time>
    </div>
    <div className="button-row"><button className={`primary-button ${voice.microphoneActive&&!listening?'conversation-end':''}`} onClick={()=>void voice.toggle()}>{voice.microphoneActive&&!listening?<MicOff size={17}/>:<Mic size={17}/>} {buttonLabel}</button>{listening&&<button className="text-button" onClick={voice.cancel}>End conversation</button>}{speaking&&<button className="text-button" onClick={voice.stopReply}>Stop reply</button>}</div>
    {voice.microphoneActive&&<div className="vad-indicator"><span className="status-dot"/> SILERO LIVE <span>{Math.round(voice.probability*100)}% speech probability</span></div>}
    {(!ready||!vadReady)&&<p className="panel-caption">{voice.health?.missing?.length ? `Missing: ${voice.health.missing.join(', ')}.` : 'Start the app with npm run dev:all. Run npm run voice:setup to install Silero if needed.'}</p>}
    {voice.error&&<div className="voice-error" role="alert">{voice.error}</div>}
    {voice.lastTranscript&&<div className="voice-transcript"><span>YOU SAID</span><p>{voice.lastTranscript}</p>{voice.timing!==null&&<small>Recognition: {(voice.timing/1000).toFixed(1)}s</small>}</div>}
    {voice.recordingUrl&&<label className="voice-replay">Your recording<audio controls preload="metadata" src={voice.recordingUrl}/></label>}
    {voice.replyUrl&&<label className="voice-replay"><span><Volume2 size={13}/> Spoken reply</span><audio controls preload="metadata" src={voice.replyUrl} onPlay={()=>voice.cancel()}/></label>}
    <p className="panel-caption"><ShieldCheck size={12}/> Local processing · English spoken replies. Use headphones for initial interruption tests; speaker echo depends on your browser and microphone.</p>
  </section>;
}
