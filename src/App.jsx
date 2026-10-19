import React, { useEffect, useRef, useState } from 'react';
import { answerQuestion } from './assistant.js';
import AnswerModeSelector from './answers/AnswerModeSelector.jsx';
import { ANSWER_MODES, normalizeAnswerMode, answerModeChange } from './answers/modes.js';
import { useCarLibrary } from './rag/useCarLibrary.js';
import { queryCar, carLabel, ragApi } from './rag/api.js';
import KnowledgeLibrary, { CarLibrary, AnswerSources } from './rag/KnowledgeLibrary.jsx';
import { useVoicePipeline } from './voice/useVoicePipeline.js';
import VoiceControls, { statusLabels } from './voice/VoiceControls.jsx';
import { Activity, ArrowDownToLine, ArrowRight, AudioLines, BookOpen, Check, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, CircleHelp, Clock3, FileText, Gauge, Headphones, LayoutDashboard, Library, Menu, MessageSquare, Mic, MicOff, MoreHorizontal, Music2, Pause, Phone, Play, Plus, Radio, Search, Send, Settings, ShieldCheck, SkipBack, SkipForward, SlidersHorizontal, Sparkles, Upload, Volume2, VolumeX, WifiOff, Wrench, X, CarFront } from 'lucide-react';

const STORE = 'autoai-ui-v1';
const initialProfile = { sample: true, name: 'My everyday escape', model: 'Hyundai i20', variant: 'Sportz · Petrol · Manual', year: '2022', mileage: '54320' };
const greeting = { role: 'assistant', text: 'Hi, I am your co-pilot. Choose a car and an answer mode. In Knowledge, add manual documents for RAG + LLM, or prewritten answers for Saved car data. I can show sources and speak replies offline.', source: 'AutoAI local processing guide' };
const demoDoc = { id: 'guide', name: 'Your AutoAI starter guide', type: 'Built-in guide', text: 'AutoAI stores your car profile, imported text documents and maintenance notes in this browser. Local music plays on your device. Voice recordings are sent only to the local backend on this computer for offline recognition and speech synthesis; temporary audio is deleted after processing. No cloud speech service is used. Add a verified manual matching your exact car, year and variant before relying on vehicle specifications. Calling and messaging are not connected. Add car-specific documents in Knowledge for local RAG answers.', date: 'Included' };
function restore() { try { return JSON.parse(localStorage.getItem(STORE) || '{}'); } catch { return {}; } }
function uid() { return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`; }
function readError(message) { return message || 'Something went wrong. Please try again.'; }

function VehicleArt() {
  return <svg className="vehicle-art" viewBox="0 0 660 275" role="img" aria-label="Illustration of a silver hatchback">
    <defs>
      <linearGradient id="body" x1="0" y1="0" x2="0" y2="1"><stop stopColor="#f2f3f2"/><stop offset=".32" stopColor="#bfc5c7"/><stop offset=".7" stopColor="#6e777e"/><stop offset="1" stopColor="#c2c5c4"/></linearGradient>
      <linearGradient id="glass" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#23343e"/><stop offset="1" stopColor="#080f13"/></linearGradient>
      <linearGradient id="rim"><stop stopColor="#9ca6ac"/><stop offset=".45" stopColor="#293138"/><stop offset="1" stopColor="#d0d5d8"/></linearGradient>
      <radialGradient id="shadow"><stop stopColor="#000" stopOpacity=".85"/><stop offset="1" stopColor="#000" stopOpacity="0"/></radialGradient>
    </defs>
    <ellipse cx="335" cy="230" rx="285" ry="27" fill="url(#shadow)"/>
    <path d="M68 174 83 141 165 123 239 67Q257 55 289 55L396 59Q416 61 439 80L494 128 565 148Q582 152 588 175L586 205 563 215 89 213 65 200Z" fill="url(#body)" stroke="#a6aeb2" strokeWidth="1.3"/>
    <path d="m189 121 66-48 45-4-7 56Z" fill="url(#glass)" stroke="#dce1df" strokeWidth="3"/>
    <path d="m309 70 80 3q17 1 32 15l39 36-159 1Z" fill="url(#glass)" stroke="#dce1df" strokeWidth="3"/>
    <path d="m166 130 335 2 59 20M87 157l475 6M87 199l477 4" fill="none" stroke="#d6dbda" strokeOpacity=".5" strokeWidth="1.5"/>
    <path d="m294 130-4 67m178-66 13 64M179 132l-12 64" stroke="#424b52" strokeOpacity=".7" fill="none"/>
    <path d="m319 143 22 1m91-1 20 2" stroke="#3e474d" strokeWidth="4" strokeLinecap="round"/>
    <path d="m72 169 49-5-12 19-42 5" fill="#d6e6e3"/><path d="m557 154 22 8 6 14-32-5Z" fill="#c55b4b"/>
    <path d="m80 190 28-5-4 13-26 3m469-7 33-3-1 9-29 3" fill="#22292e"/>
    <path d="m450 117 25 3 8 10-32-1Z" fill="#9da9b0" stroke="#5f6a73"/>
    {[167,486].map((cx)=><g key={cx}><circle cx={cx} cy="202" r="43" fill="#11171b" stroke="#4c565d" strokeWidth="2"/><circle cx={cx} cy="202" r="30" fill="url(#rim)" stroke="#697780" strokeWidth="2"/>{[0,60,120,180,240,300].map(a=><path key={a} d={`M${cx-4} 177h8l3 21-7 5-7-5Z`} transform={`rotate(${a} ${cx} 202)`} fill="#b8c1c7" stroke="#404b53" strokeWidth="1.5"/>)}<circle cx={cx} cy="202" r="8" fill="#6e7c86" stroke="#c5ced2" strokeWidth="2"/></g>)}
    <path d="M219 85q58-24 180-5" stroke="#fff" strokeOpacity=".25" fill="none"/>
  </svg>;
}

export default function App() {
  const saved = useRef(restore()).current;
  const [view, setView] = useState('Overview');
  const [answerMode, setAnswerMode] = useState(() => normalizeAnswerMode(saved.answerMode));
  const [profile, setProfile] = useState(saved.profile || initialProfile);
  const [originalProfile, setOriginalProfile] = useState(saved.originalProfile || (saved.profile?.ragCarId ? initialProfile : saved.profile || initialProfile));
  const [documents, setDocuments] = useState((saved.documents || [demoDoc]).map(doc=>doc.id==='guide'?demoDoc:doc));
  const [allNotes, setNotes] = useState(saved.notes || []);
  const notes = allNotes.filter(note => (note.carId || null) === (profile.ragCarId || null));
  const [carProfiles, setCarProfiles] = useState(saved.carProfiles || {});
  const library = useCarLibrary();
  const activeCar = library.cars.find(car => car.id === profile.ragCarId);
  const [answering, setAnswering] = useState(false);
  const questionRequest = useRef({ id: 0, controller: null });
  const [messages, setMessages] = useState([greeting]);
  const [input, setInput] = useState('');
  const [modal, setModal] = useState(null);
  const [toast, setToast] = useState('');
  const [mobileNav, setMobileNav] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedDoc, setSelectedDoc] = useState(null);
  const [playlist, setPlaylist] = useState([]);
  const [trackIndex, setTrackIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(.65);
  const [storageError, setStorageError] = useState(false);
  const audio = useRef(null), audioInput = useRef(null), bottom = useRef(null), toastTimer = useRef(null), trackUrls = useRef([]);
  const currentTrack = playlist[trackIndex];
  const legacyDocuments = documents.filter(doc => doc.id !== 'guide');
  const notify = (text) => { setToast(text); clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(''), 4200); };

  useEffect(() => { try { localStorage.setItem(STORE, JSON.stringify({ profile, originalProfile, documents, notes: allNotes, carProfiles, answerMode })); setStorageError(false); } catch { setStorageError(true); } }, [profile, originalProfile, documents, allNotes, carProfiles, answerMode]);
  useEffect(() => { if(audio.current) audio.current.volume = volume; }, [volume]);
  useEffect(() => { if (view === 'Assistant') bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, [messages, view]);
  useEffect(() => { return () => { questionRequest.current.controller?.abort(); clearTimeout(toastTimer.current); trackUrls.current.forEach(URL.revokeObjectURL); }; }, []);

  const navigate = (next) => { setView(next); setMobileNav(false); setQuery(''); };
  const ask = async (question, { signal } = {}) => {
    const text = question.trim(); if (!text) return null;
    questionRequest.current.controller?.abort();
    const controller = new AbortController();
    const id = ++questionRequest.current.id;
    questionRequest.current.controller = controller;
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) controller.abort();
    setInput(''); setView('Assistant'); setAnswering(true);
    setMessages(prev => [...prev, { role: 'user', text, answer_mode: answerMode, carName: activeCar ? carLabel(activeCar) : null }]);
    try {
      let result = answerQuestion(text, { profile, documents: [], notes, hasMusic: playlist.length > 0, useRag: true });
      if (result.rag) result = activeCar ? await queryCar(activeCar.id, text, controller.signal, answerMode) : { text: answerMode === 'saved' ? 'Choose or add a car in Knowledge, then add prewritten answers under Saved car answers. This mode does not search manuals or use the LLM.' : 'Choose or add a car in Knowledge, then import a manual matching its year, variant, and market. I need that car’s documents before answering.', mode: answerMode === 'saved' ? 'saved_missing' : 'insufficient', answer_mode: answerMode };
      if (controller.signal.aborted || questionRequest.current.id !== id) return null;
      if (result.action === 'music_pause') audio.current?.pause();
      if (result.action === 'music_play') void playTrack();
      if (result.action === 'music_next') void playTrack(trackIndex + 1);
      if (result.action === 'music_previous') void playTrack(trackIndex - 1);
      if (result.action === 'volume_up') setVolume(value=>Math.min(1,value+.15));
      if (result.action === 'volume_down') setVolume(value=>Math.max(0,value-.15));
      if (result.action === 'open_music') notify('Open Music to choose local audio files.');
      setMessages(prev => [...prev, { role: 'assistant', ...result, carName: activeCar ? carLabel(activeCar) : null }]);
      return result;
    } catch (issue) {
      if (issue.name !== 'AbortError' && !controller.signal.aborted && questionRequest.current.id === id) {
        setMessages(prev => [...prev, { role: 'assistant', text: issue.message, source: 'Local car library connection' }]); notify(issue.message);
      }
      return null;
    } finally {
      signal?.removeEventListener('abort', abort);
      if (questionRequest.current.id === id) setAnswering(false);
    }
  };
  function changeAnswerMode(next) {
    const change = answerModeChange(answerMode, next);
    if (!change.cancelPending) return;
    voice.cancel(); questionRequest.current.controller?.abort(); questionRequest.current.id++; setAnswering(false);
    setAnswerMode(change.mode);
    notify(`${ANSWER_MODES[change.mode].label} selected. Start voice again if needed.`);
  }
  function selectCar(car) {
    if (car?.id === profile.ragCarId) { setModal(null); return; }
    voice.cancel(); questionRequest.current.controller?.abort(); questionRequest.current.id++; setAnswering(false);
    if (profile.ragCarId) setCarProfiles(previous => ({ ...previous, [profile.ragCarId]: profile }));
    else setOriginalProfile(profile);
    if (!car) setProfile({ ...originalProfile });
    else setProfile(carProfiles[car.id] || { sample: false, ragCarId: car.id, name: `My ${car.model}`, model: `${car.make} ${car.model}`, year: String(car.year), variant: car.variant, mileage: '' });
    setMessages([greeting]); setModal(null);
  }

  const voice = useVoicePipeline({ onTranscript: ask, onBeforeCapture: ()=>audio.current?.pause(), onError: notify });
  const recording = voice.status === 'listening';
  const micBusy = false;
  const toggleRecording = ()=>void voice.toggle();
  const voiceReady = Boolean(voice.health?.ready && voice.health?.vad?.ready);

  function importMusic(event) {
    const files = [...event.target.files]; event.target.value = '';
    const added = files.filter(file=>file.type.startsWith('audio/')||/\.(mp3|wav|ogg|m4a|flac)$/i.test(file.name)).map(file=>({id:uid(),name:file.name.replace(/\.[^.]+$/,''),url:URL.createObjectURL(file)}));
    if(!added.length) return notify('Choose a supported audio file.');
    trackUrls.current.push(...added.map(t=>t.url)); setPlaylist(prev=>[...prev,...added]); notify('Music added for this session. Your files stay on your device.');
  }
  async function playTrack(index=trackIndex) {
    if(!playlist.length) { audioInput.current.click(); return; }
    const next = (index+playlist.length)%playlist.length;
    setTrackIndex(next); if(audio.current.src!==playlist[next].url) { audio.current.src=playlist[next].url; setProgress(0); }
    try { await audio.current.play(); } catch { notify('This audio file could not play. Try an MP3 or WAV file.'); }
  }

  async function exportData() {
    let indexedCar = null;
    try { if (activeCar) indexedCar = await ragApi(`cars/${activeCar.id}/export`); }
    catch (issue) { notify(issue.message); return; }
    const url=URL.createObjectURL(new Blob([JSON.stringify({profile,documents,notes:allNotes,carProfiles,originalProfile,answerMode,carLibrary:library.cars,indexedCar},null,2)],{type:'application/json'}));
    const link=document.createElement('a');link.href=url;link.download='autoai-local-data.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);notify('Browser records and the selected car’s indexed passages exported.');
  }
  const time = (seconds) => Number.isFinite(seconds) ? `${Math.floor(seconds/60)}:${String(Math.floor(seconds%60)).padStart(2,'0')}` : '0:00';

  const navItems = [{name:'Overview',icon:LayoutDashboard},{name:'Assistant',icon:AudioLines},{name:'My vehicle',icon:CarFront},{name:'Knowledge',icon:BookOpen},{name:'Music',icon:Music2},{name:'Maintenance',icon:Wrench}];
  const quickActions = [{icon:MessageSquare,title:'Ask about my car',description:'A little clarity, on demand',click:()=>navigate('Assistant')},{icon:Music2,title:'Set the mood',description:'Your music. Your kind of drive.',click:()=>navigate('Music')},{icon:Phone,title:'Stay connected',description:'Calls & messages',click:()=>setModal('phone')},{icon:Wrench,title:'Keep it running',description:'Service notes & reminders',click:()=>navigate('Maintenance')}];

  const renderMusicCard = ({expanded=false}={}) => <section className={`panel music-panel ${expanded?'expanded':''}`}>
    <div className="section-label"><span><Music2 size={15}/> YOUR SOUNDTRACK</span><button className="icon-button" aria-label="Add music files" onClick={()=>audioInput.current.click()}><Plus size={18}/></button></div>
    <div className="track-info"><div className="album-art"><span/><i/><Music2 size={27}/></div><div><span className="eyebrow">LOCAL LIBRARY</span><h3>{currentTrack?.name || 'Make this drive yours'}</h3><p>{currentTrack ? `${trackIndex+1} of ${playlist.length} tracks · On this device` : 'Add your favourite songs to get started'}</p></div></div>
    <div className="playback"><button className="icon-button" aria-label="Previous track" disabled={!playlist.length} onClick={()=>playTrack(trackIndex-1)}><SkipBack size={18}/></button><button className="play-button" aria-label={playing?'Pause music':playlist.length?'Play music':'Choose music'} onClick={()=>playing?audio.current.pause():playTrack()}>{playing?<Pause size={19} fill="currentColor"/>:<Play size={19} fill="currentColor"/>}</button><button className="icon-button" aria-label="Next track" disabled={!playlist.length} onClick={()=>playTrack(trackIndex+1)}><SkipForward size={18}/></button></div>
    <div className="track-progress"><span>{time(progress)}</span><input aria-label="Track position" type="range" min="0" max={duration||1} step=".1" value={Math.min(progress,duration||1)} disabled={!duration} onChange={e=>{audio.current.currentTime=Number(e.target.value);setProgress(Number(e.target.value));}}/><span>{time(duration)}</span></div>
    {expanded&&<><div className="volume-control"><Volume2 size={17}/><input type="range" min="0" max="1" step=".01" value={volume} onChange={e=>setVolume(Number(e.target.value))} aria-label="Music volume"/></div><div className="track-list">{playlist.map((track,i)=><button key={track.id} onClick={()=>playTrack(i)} className={i===trackIndex?'selected':''}><Music2 size={17}/><span>{track.name}</span>{i===trackIndex&&playing?<AudioLines size={16}/>:<Play size={15}/>}</button>)}{!playlist.length&&<div className="empty-state"><Headphones size={25}/><p>Your next favourite drive starts here.</p><button className="secondary-button" onClick={()=>audioInput.current.click()}><Plus size={15}/> Add local music</button></div>}</div></>}
  </section>;

  const renderProfileCard = () => <section className="panel vehicle-panel"><div className="section-label"><span><CarFront size={15}/> YOUR VEHICLE</span><button className="icon-button" aria-label="Edit car profile" onClick={()=>setModal('profile')}><SlidersHorizontal size={17}/></button></div><div className="vehicle-title"><h3>{profile.model}</h3><span className="subtle-badge">{profile.year}</span></div><p className="muted vehicle-variant">{profile.sample ? "Sample profile / " : ""}{profile.variant}</p><VehicleArt/><div className="vehicle-stats"><div><Gauge size={16}/><span>Odometer<strong>{(profile.mileage === '' ? 'Not recorded' : Number(profile.mileage).toLocaleString('en-IN'))} <small>km</small></strong></span></div><div><ShieldCheck size={16}/><span>Profile<strong>Saved locally</strong></span></div></div><button className="text-button vehicle-link" onClick={()=>navigate('My vehicle')}>View my vehicle <ArrowRight size={15}/></button></section>;

  return <div className="app-shell">
    <input ref={audioInput} type="file" accept="audio/*,.mp3,.wav,.ogg,.m4a,.flac" multiple hidden onChange={importMusic}/>
    <audio ref={audio} onPlay={()=>setPlaying(true)} onPause={()=>setPlaying(false)} onTimeUpdate={e=>setProgress(e.currentTarget.currentTime)} onLoadedMetadata={e=>setDuration(e.currentTarget.duration)} onEnded={()=>playlist.length>1?playTrack(trackIndex+1):setPlaying(false)} onError={()=>{setPlaying(false);setDuration(0);notify('Could not read this audio file. Try another format.');}}/>
    {mobileNav&&<button className="nav-backdrop" aria-label="Close navigation" onClick={()=>setMobileNav(false)}/>}
    <aside className={`sidebar ${mobileNav?'open':''}`}>
      <a className="brand" href="#" onClick={e=>{e.preventDefault();navigate('Overview');}}><div className="brand-symbol"><span/><span/></div><span>auto<span className="brand-ai">ai</span><sup>®</sup></span></a>
      <div className="workspace-label">YOUR PERSONAL CO-PILOT</div>
      <nav aria-label="Main navigation">{navItems.map(({name,icon:Icon})=><button key={name} className={`nav-item ${view===name?'active':''}`} onClick={()=>navigate(name)} aria-current={view===name?'page':undefined}><Icon size={19}/><span>{name}</span>{name==='Assistant'&&<span className="nav-new">NEW</span>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="local-card"><div className="local-icon"><ShieldCheck size={20}/></div><h4>A little more private.</h4><p>Your records stay right here,<br/>on this computer.</p><span><span className="status-dot"/> LOCAL UI PREVIEW</span></div><button className={`nav-item ${view==='Settings'?'active':''}`} onClick={()=>navigate('Settings')}><Settings size={19}/><span>Settings</span></button><div className="user-profile"><div className="avatar">NR</div><div><strong>Niharika</strong><span>Personal workspace</span></div><button className="icon-button" aria-label="Open workspace settings" onClick={()=>navigate('Settings')}><ChevronDown size={16}/></button></div></div>
    </aside>
    <div className="workspace">
      <header className="topbar"><div className="breadcrumb"><button className="icon-button mobile-menu" aria-label="Open navigation" onClick={()=>setMobileNav(true)}><Menu size={21}/></button><span>Workspace</span><ChevronRight size={13}/><strong>{view}</strong></div><div className="topbar-right"><span className="connection-pill"><span className="status-dot"/> Local preview</span>{voice.microphoneActive&&<button className="mic-live-button" aria-label="End voice conversation and turn microphone off" onClick={voice.cancel}><span className="status-dot"/> Mic on <MicOff size={13}/></button>}<span className="header-divider"/><button className="icon-button" aria-label="About this preview" onClick={()=>setModal('about')}><CircleHelp size={19}/></button><div className="avatar small">NR</div></div></header>
      <main id="main-content">
        <div className="page-heading"><div><div className="eyebrow page-kicker">{view==='Overview'?'A LITTLE LESS EFFORT. A BETTER DRIVE.':'YOUR PERSONAL CO-PILOT'}</div><h1>{({Overview:'Your drive, simplified.',Assistant:'Let’s talk about your car.','My vehicle':'A car that feels like yours.',Knowledge:'A little knowledge goes a long way.',Music:'Every drive has a soundtrack.',Maintenance:'Good care. More good miles.',Settings:'Make yourself at home.'})[view]}</h1><p>{({Overview:'Your car. Your voice. Everything in one place.',Assistant:'Ask a question, find an answer, keep moving.','My vehicle':'The details that make your assistant personal.',Knowledge:'Give your assistant the right information for your car.',Music:'Your favourite audio, playing right from your device.',Maintenance:'Keep your service history close and your next step clear.',Settings:'Your preferences, your data, your choice.'})[view]}</p></div><button className="vehicle-selector" onClick={()=>setModal('cars')}><CarFront size={18}/><span>{activeCar ? `${activeCar.make} ${activeCar.model}` : 'Choose car library'}</span><ChevronDown size={14}/></button></div>
        {storageError&&<div className="notice warning">Browser storage is full or unavailable. New changes may not survive a reload. Export your records in Settings.</div>}
        {['Overview','Assistant','Knowledge','Settings'].includes(view)&&<AnswerModeSelector mode={answerMode} onChange={changeAnswerMode} health={library.health}/>}
        {view==='Overview'&&<>
          <div className="dashboard-top"><section className="panel assistant-panel"><div className="section-label"><span><Sparkles size={15}/> AUTOAI ASSISTANT</span><span className="subtle-badge"><span className="status-dot"/> {voiceReady ? 'Offline voice ready' : 'Text ready'}</span></div><div className={`voice-visual ${recording?'recording':''} ${voice.status==='speaking'?'speaking':''}`}><div className="orbit orbit-one"/><div className="orbit orbit-two"/><div className="orbit orbit-three"/><button className="voice-orb" aria-label={recording?'Finish speaking and get a reply':voice.microphoneActive?'End voice conversation and turn microphone off':'Start offline voice conversation'} disabled={micBusy} onClick={toggleRecording}>{recording?<MicOff size={34} strokeWidth={1.3}/>:<AudioLines size={40} strokeWidth={1.4}/>}</button><span className="orb-spark spark-one"/><span className="orb-spark spark-two"/></div><div className="assistant-intro"><h2>{(voice.busy || voice.microphoneActive) ? statusLabels[voice.status] : 'A helping hand. Just a word away.'}</h2><p>{recording ? 'Pause after your question. Speak again to interrupt a reply.' : voiceReady ? 'Start a conversation. Speak naturally. Interrupt whenever you need.' : 'Ask by text, or start the local backend for offline voice.'}</p></div><form className="ask-input" onSubmit={e=>{e.preventDefault();voice.cancel();ask(input);}}><MessageSquare size={17}/><input aria-label="Ask your car assistant" maxLength={600} value={input} onChange={e=>setInput(e.target.value)} placeholder="What would you like to know?"/><button type="submit" className="send-button" aria-label="Send question"><ArrowRight size={18}/></button></form><div className="assistant-footnote"><ShieldCheck size={12}/><span>{voiceReady ? 'Offline voice connected' : 'Local text available'}</span><span className="dot-divider">·</span><span>{voiceReady ? voice.microphoneActive ? 'Mic on - tap to end' : 'Start a conversation' : 'Voice backend not connected'}</span></div></section>{renderProfileCard()}</div>
          <div className="section-heading"><h2>A shortcut to your next move</h2><span>LESS TAPPING. MORE DRIVING.</span></div><div className="quick-grid">{quickActions.map(({icon:Icon,title,description,click})=><button className="quick-card" key={title} onClick={click}><div className="quick-icon"><Icon size={20}/></div><h3>{title}</h3><p>{description}</p><ArrowRight size={15} className="quick-arrow"/></button>)}</div>
          <div className="dashboard-bottom">{renderMusicCard()}<section className="panel maintenance-preview"><div className="section-label"><span><Wrench size={15}/> A LITTLE CAR CARE</span><button className="text-button" onClick={()=>navigate('Maintenance')}>View all <ArrowRight size={14}/></button></div><div className="care-content"><div className="care-icon"><Wrench size={26} strokeWidth={1.4}/></div><div><h3>{notes.length?'Your car’s story, kept safe.':'Good miles start with good care.'}</h3><p>{notes.length?`${notes.length} maintenance ${notes.length===1?'record':'records'} saved on this browser.`:'Add your last service to start a history you can trust.'}</p></div></div><div className="care-bottom"><span><Clock3 size={14}/> {notes.length?`Latest: ${notes[0].date}`:'No service records yet'}</span><button className="secondary-button" onClick={()=>setModal('service')}><Plus size={14}/> Add a record</button></div></section></div>
          <div className="privacy-footer"><ShieldCheck size={14}/><span>Built around you. Your profile, notes, and car library stay on this computer.</span><button onClick={()=>navigate('Settings')}>Your privacy <ArrowRight size={13}/></button></div>
        </>}
        {view==='Assistant'&&<div className="assistant-layout"><section className="panel chat-panel"><div className="section-label"><span><Sparkles size={15}/> YOUR CONVERSATION</span><button className="text-button" onClick={()=>{voice.cancel();questionRequest.current.controller?.abort();questionRequest.current.id++;setAnswering(false);setMessages([greeting]);notify('Conversation cleared.');}}>Clear chat</button></div><div className="conversation" aria-live="polite">{messages.map((m,i)=><div key={i} className={`chat-message ${m.role}`}><div className="chat-avatar">{m.role==='assistant'?<AudioLines size={19}/>:<span>NR</span>}</div><div><span className="message-author">{m.role==='assistant'?'AutoAI':'You'}</span><p>{m.text}</p><AnswerSources message={m}/>{!m.mode&&m.source&&<span className="source-label"><FileText size={12}/>{m.source}</span>}{m.role==='assistant'&&voiceReady&&<button className="text-button speak-message" onClick={()=>void voice.speak(m.text)}><Volume2 size={13}/> Read aloud</button>}</div></div>)}{answering&&<div className="rag-working" role="status"><Sparkles size={16}/> {answerMode === 'saved' ? 'Looking up a prewritten car answer…' : 'Searching the selected car’s sources and preparing an answer…'}<button className="text-button" onClick={()=>{questionRequest.current.controller?.abort();questionRequest.current.id++;setAnswering(false);}}>Cancel answer</button></div>}<div ref={bottom}/></div><form className="ask-input" onSubmit={e=>{e.preventDefault();voice.cancel();ask(input);}}><input aria-label="Message AutoAI" maxLength={600} placeholder="Ask about your car or your saved documents…" value={input} onChange={e=>setInput(e.target.value)}/><button className="send-button" aria-label="Send message"><Send size={17}/></button></form><p className="panel-caption">{answerMode === 'saved' ? 'Saved car data · Prewritten answers only. Add missing answers and alternative questions in Knowledge.' : 'Selected-car RAG · Expand a source to check the evidence. AI summaries can be wrong.'}</p></section><div className="assistant-aside"><VoiceControls voice={voice}/><section className="panel"><div className="section-label"><span><MessageSquare size={15}/> TRY ASKING</span></div>{['What information is stored locally?','When is my next service?','How do I play my music?'].map(q=><button className="suggestion" key={q} onClick={()=>{voice.cancel();ask(q);}}>{q}<ArrowRight size={14}/></button>)}</section></div></div>}
        {view==='My vehicle'&&<div className="detail-grid">{renderProfileCard()}<section className="panel"><div className="section-label"><span><SlidersHorizontal size={15}/> PROFILE DETAILS</span><button className="text-button" onClick={()=>setModal('profile')}>Edit profile <ArrowRight size={14}/></button></div><h2>{profile.name}</h2><p className="muted">The starting profile is sample data. Update it to match your own car.</p><dl className="detail-list">{[['Model',profile.model],['Year',profile.year],['Variant',profile.variant],['Odometer',`${(profile.mileage === '' ? 'Not recorded' : Number(profile.mileage).toLocaleString('en-IN'))} km`],['Vehicle data','Manually entered · not live telemetry'],['Diagnostic connection','Not connected']].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl><div className="notice"><BookOpen size={18}/><span>Add a verified manual for this exact year and variant to personalise answers.</span></div><button className="secondary-button" onClick={()=>navigate('Knowledge')}>Open knowledge library <ArrowRight size={15}/></button></section></div>}
        {view==='Knowledge'&&<KnowledgeLibrary library={library} activeCar={activeCar} onSelect={selectCar} onManage={()=>setModal('cars')} onNotify={notify} legacyDocuments={legacyDocuments} onMigrated={id=>setDocuments(previous=>previous.filter(doc=>doc.id!==id))}/>}
        {view==='Music'&&<div className="music-page">{renderMusicCard({expanded:true})}<section className="panel music-notes"><div className="section-label"><span><Headphones size={15}/> JUST YOU AND THE ROAD</span></div><div className="record-illustration"><div/><Music2 size={34}/></div><h2>No signal?<br/>Still a good soundtrack.</h2><p className="muted">Choose audio files already on your device. Nothing is uploaded, and no streaming account is needed.</p><button className="primary-button" onClick={()=>audioInput.current.click()}><Plus size={16}/> Choose audio files</button><p className="panel-caption">Your playlist lasts for this session. Choose your files again after reloading.</p></section></div>}
        {view==='Maintenance'&&<><div className="content-toolbar"><div><h2>Your service journal</h2><p className="muted">Small records today. A clearer picture tomorrow.</p></div><button className="primary-button" onClick={()=>setModal('service')}><Plus size={16}/> Add service record</button></div><div className="notice"><Clock3 size={17}/><span>Service due dates need a verified maintenance schedule. No due dates or vehicle health claims are inferred in this preview.</span></div><section className="panel service-list">{notes.length?notes.map(note=><article className="service-item" key={note.id}><div className="document-icon"><Wrench size={21}/></div><div><h3>{note.title}</h3><p>{note.description||'No additional notes.'}</p><span>{note.date} · {Number(note.mileage).toLocaleString('en-IN')} km</span></div><span className="subtle-badge">Recorded</span></article>):<div className="empty-state"><div className="care-icon"><Wrench size={29}/></div><h2>Every car has a story.</h2><p>Start yours with an oil change, a new battery,<br/>or your most recent service.</p><button className="primary-button" onClick={()=>setModal('service')}><Plus size={16}/> Add your first record</button></div>}</section></>}
        {view==='Settings'&&<div className="settings-grid"><section className="panel"><div className="section-label"><span><ShieldCheck size={16}/> YOUR DATA</span></div><h2>Yours, from the start.</h2><p className="muted">Profiles and service notes are saved in this browser’s local storage. Indexed manuals and embeddings are stored in local SQLite on this computer. They are not encrypted by this preview. Recordings are processed by the local backend on this computer, then its temporary files are deleted. Audio files and replay clips stay in session memory.</p><dl className="detail-list"><div><dt>Documents</dt><dd>{library.health?.documents || 0}</dd></div><div><dt>Service records</dt><dd>{notes.length}</dd></div><div><dt>Cloud sync</dt><dd>Not connected</dd></div></dl><div className="button-row"><button className="secondary-button" onClick={exportData}><ArrowDownToLine size={16}/> Export records</button><button className="text-button danger-text" onClick={()=>setModal('reset')}>Reset local records</button></div></section><section className="panel"><div className="section-label"><span><Activity size={16}/> CONNECTIONS</span></div><h2>A clear view of what’s ready.</h2><dl className="detail-list">{[['Local interface','Ready'],['Car configurations',String(library.cars.length)],['Music file playback','Ready'],['Offline speech recognition',voiceReady?'Ready':'Backend / setup needed'],['Offline speech output',voiceReady?'Ready (English)':'Backend / setup needed'],['Speech detection',voice.health?.vad?.ready?'Silero VAD ready':'Setup needed'],['Answer mode',ANSWER_MODES[answerMode].label],['Saved car answers',library.health?.saved_answers_ready?'Available without AI models':'Backend needed'],['RAG + LLM',library.health?.ready?'Ready (optional)':'Optional setup needed'],['Phone bridge','Not connected'],['Vehicle diagnostics','Not connected']].map(([label,value])=><div key={label}><dt>{label}</dt><dd className={value==='Ready'?'ready-text':''}>{value}</dd></div>)}</dl></section></div>}
        <footer className="app-footer"><span>AUTOAI <span>·</span> MADE FOR THE ROAD AHEAD</span><span>UI prototype <span>·</span> v0.1</span></footer>
      </main>
    </div>
    {(modal||selectedDoc)&&<Dialog title={selectedDoc?selectedDoc.name:({cars:'Your car library.',profile:'Make it your car.',service:'A little care, recorded.',phone:'Your phone, connected. Soon.',about:'Meet your personal co-pilot.',reset:'Reset your local records?'})[modal]} onClose={()=>{setModal(null);setSelectedDoc(null);}}>
      {selectedDoc?<><div className="notice">Imported content is not automatically verified against your car.</div><p className="document-full">{selectedDoc.text}</p>{selectedDoc.id!=='guide'&&<button className="text-button danger-text" onClick={()=>{setDocuments(prev=>prev.filter(d=>d.id!==selectedDoc.id));setSelectedDoc(null);notify('Document removed.');}}>Remove document</button>}</>:modal==='cars'?<CarLibrary library={library} activeId={activeCar?.id} onSelect={selectCar} onNotify={notify}/>:modal==='profile'?<ProfileForm profile={profile} onSave={next=>{setProfile(next);setModal(null);notify('Your vehicle profile is saved.');}}/>:modal==='service'?<ServiceForm profile={profile} onSave={record=>{setNotes(prev=>[{...record,id:uid(),carId:profile.ragCarId||null},...prev]);setModal(null);notify('Service record saved locally.');}}/>:modal==='phone'?<><div className="dialog-feature-icon"><Phone size={29}/></div><p className="muted">Calling and messaging need a supported phone connection. This browser preview is not connected to a phone and cannot send messages or make calls.</p><div className="notice">No phone action has been started.</div><button className="primary-button" onClick={()=>{setModal(null);navigate('Settings');}}>View connections <ArrowRight size={16}/></button></>:modal==='reset'?<><p className="muted">This removes browser profiles, unassigned documents, and maintenance notes. The SQLite car library is separate; remove its cars and documents in Knowledge. Export your records first if you want to keep them.</p><button className="primary-button danger" onClick={()=>{voice.cancel();questionRequest.current.controller?.abort();questionRequest.current.id++;setAnswering(false);setProfile(initialProfile);setOriginalProfile(initialProfile);setAnswerMode('rag');setCarProfiles({});setDocuments([demoDoc]);setNotes([]);setMessages([greeting]);setModal(null);notify('Local records reset to the sample profile.');}}>Reset records</button></>:<><div className="dialog-feature-icon"><AudioLines size={30}/></div><p className="muted">A calmer place for your car, your questions, and your music. This is an interactive local UI prototype.</p><p className="muted">Car details begin as sample data. Text search, notes, recording, and audio playback work locally. Offline voice recognition and spoken replies are available through the local backend. Local RAG generation uses only the selected car’s indexed sources. Phone actions and live diagnostics are not connected.</p><button className="primary-button" onClick={()=>setModal(null)}>Got it <Check size={16}/></button></>}
    </Dialog>}
    {toast&&<div className="toast" role="status"><CheckCircle2 size={18}/><span>{toast}</span><button className="icon-button" aria-label="Dismiss notification" onClick={()=>setToast('')}><X size={15}/></button></div>}
  </div>;
}

function Dialog({title,onClose,children}) {
  const ref=useRef(null);
  useEffect(()=>{const dialog=ref.current;dialog.showModal();return()=>dialog.close();},[]);
  return <dialog ref={ref} className="dialog" onCancel={onClose} onClick={e=>{if(e.target===ref.current)onClose();}} aria-labelledby="dialog-title"><div className="dialog-inner"><div className="dialog-header"><h2 id="dialog-title">{title}</h2><button className="icon-button" autoFocus aria-label="Close dialog" onClick={onClose}><X size={20}/></button></div>{children}</div></dialog>;
}
function ProfileForm({profile,onSave}) {
  const [form,setForm]=useState(profile);
  return <form className="editor-form" onSubmit={e=>{e.preventDefault();onSave({...Object.fromEntries(Object.entries(form).map(([key,value])=>[key,String(value).trim()])),sample:false});}}>{[{key:'name',label:'Nickname',placeholder:'My everyday escape'},{key:'model',label:'Make and model',placeholder:'Hyundai i20'},{key:'variant',label:'Variant, fuel, and transmission',placeholder:'Sportz · Petrol · Manual'},{key:'year',label:'Model year',type:'number',min:1900,max:new Date().getFullYear()+1},{key:'mileage',label:'Odometer (km)',type:'number',min:0,max:9999999}].map(field=><label key={field.key}>{field.label}<input required pattern={field.type ? undefined : ".*\\S.*"} maxLength={100} type={field.type||'text'} min={field.min} max={field.max} placeholder={field.placeholder} value={form[field.key]} readOnly={Boolean(profile.ragCarId && ['model','year','variant'].includes(field.key))} onChange={e=>setForm(prev=>({...prev,[field.key]:e.target.value}))}/></label>)}<p className="panel-caption">Manually entered details. Model identity comes from the selected library car; add another configuration in Knowledge.</p><button className="primary-button" type="submit">Save vehicle <Check size={16}/></button></form>;
}
function ServiceForm({profile,onSave}) {
  const [form,setForm]=useState({title:'',description:'',date:new Date().toLocaleDateString('en-CA'),mileage:profile.mileage});
  return <form className="editor-form" onSubmit={e=>{e.preventDefault();onSave({...form,title:form.title.trim(),description:form.description.trim()});}}><label>What was done?<input required pattern=".*\S.*" maxLength={160} placeholder="e.g. Engine oil and filter replaced" value={form.title} onChange={e=>setForm({...form,title:e.target.value})}/></label><div className="form-columns"><label>Service date<input required type="date" value={form.date} onChange={e=>setForm({...form,date:e.target.value})}/></label><label>Odometer (km)<input required type="number" min="0" max="9999999" value={form.mileage} onChange={e=>setForm({...form,mileage:e.target.value})}/></label></div><label>Notes <span className="muted">(optional)</span><textarea maxLength={2000} rows="3" placeholder="Workshop, parts, or anything worth remembering" value={form.description} onChange={e=>setForm({...form,description:e.target.value})}/></label><button type="submit" className="primary-button">Save record <Check size={16}/></button></form>;
}


