import React, { useEffect, useRef, useState } from 'react';
import { ArrowRight, BookOpen, CarFront, Check, FileText, LoaderCircle, Plus, Search, ShieldCheck, Trash2, Upload } from 'lucide-react';
import { carLabel, ragApi } from './api.js';
import SavedCarAnswers from '../answers/SavedCarAnswers.jsx';

export function CarLibrary({ library, activeId, onSelect, onNotify }) {
  const [form, setForm] = useState({ make: '', model: '', year: new Date().getFullYear(), variant: '', market: 'India' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  async function add(event) {
    event.preventDefault(); setSaving(true); setError('');
    try {
      const car = await ragApi('cars', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...form, year: Number(form.year) }) });
      await library.refresh(); onSelect(car); onNotify('Car added. Import a matching manual in Knowledge.');
      setForm({ ...form, make: '', model: '', variant: '' });
    } catch (issue) { setError(issue.message); }
    finally { setSaving(false); }
  }
  return <div className="car-library">
    <p className="muted">Each year, variant, and market has its own manual collection and saved answers. Select the exact configuration you want the assistant to answer about.</p>
    <div className="car-options">{library.cars.map(car => <button key={car.id} className={`car-option ${car.id === activeId ? 'selected' : ''}`} onClick={() => onSelect(car)}>
      <CarFront size={21}/><span><strong>{car.make} {car.model} <small>{car.year}</small></strong><span>{car.variant} · {car.market}</span><small>{car.documents} documents · {car.saved_answers || 0} saved answers</small></span>{car.id === activeId ? <Check size={17}/> : <ArrowRight size={17}/>}
    </button>)}</div>
    <button className="text-button" onClick={() => onSelect(null)}>Use my original personal profile <ArrowRight size={14}/></button>
    <form className="editor-form car-create" onSubmit={add}><h3><Plus size={17}/> Add a car configuration</h3>
      <div className="form-columns">{[['make', 'Make', 'Hyundai'], ['model', 'Model', 'i20']].map(([key, label, placeholder]) => <label key={key}>{label}<input required maxLength={80} value={form[key]} placeholder={placeholder} onChange={e => setForm({ ...form, [key]: e.target.value })}/></label>)}</div>
      <div className="form-columns"><label>Model year<input type="number" required min="1900" max="2100" value={form.year} onChange={e => setForm({ ...form, year: e.target.value })}/></label><label>Market / country<input required maxLength={80} value={form.market} onChange={e => setForm({ ...form, market: e.target.value })}/></label></div>
      <label>Exact variant, engine, and transmission<input required maxLength={120} placeholder="Sportz · 1.2 petrol · manual" value={form.variant} onChange={e => setForm({ ...form, variant: e.target.value })}/></label>
      {(error || library.error) && <p className="voice-error" role="alert">{error || library.error}</p>}
      <button className="primary-button" disabled={saving}>{saving ? <LoaderCircle className="spin" size={16}/> : <Plus size={16}/>} {saving ? 'Saving…' : 'Add car'}</button>
    </form>
  </div>;
}

export default function KnowledgeLibrary({ library, activeCar, onSelect, onManage, onNotify, legacyDocuments, onMigrated }) {
  const [documents, setDocuments] = useState([]);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);
  const [removing, setRemoving] = useState(null);
  const [removeCar, setRemoveCar] = useState(false);
  const [loading, setLoading] = useState(false);
  const upload = useRef(null);
  const activeId = useRef(activeCar?.id); activeId.current = activeCar?.id;
  async function reload(carId) {
    const result = await ragApi(`cars/${carId}/documents`);
    if (activeId.current === carId) setDocuments(result.documents);
    await library.refresh();
  }
  useEffect(() => {
    const controller = new AbortController();
    setDocuments([]); setSelected(null); setRemoving(null); setError(''); setRemoveCar(false);
    if (activeCar) {
      setLoading(true);
      ragApi(`cars/${activeCar.id}/documents`, { signal: controller.signal }).then(result => setDocuments(result.documents))
        .catch(issue => { if (issue.name !== 'AbortError') setError(issue.message); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }
    return () => controller.abort();
  }, [activeCar?.id]);

  async function importFiles(event) {
    const files = [...event.target.files]; event.target.value = '';
    const car = activeCar; if (!car) return;
    setError(''); let count = 0;
    for (const file of files) {
      if (!/\.(pdf|txt|md)$/i.test(file.name) || file.size > 8 * 1024 * 1024) { setError(`${file.name}: choose PDF, TXT, or MD up to 8 MB.`); continue; }
      setBusy(`Indexing ${file.name}`);
      try {
        await ragApi(`cars/${car.id}/documents?name=${encodeURIComponent(file.name)}`, { method: 'POST', body: file, headers: { 'Content-Type': 'application/octet-stream' } }); count++;
      } catch (issue) { setError(`${file.name}: ${issue.message}`); }
    }
    try { await reload(car.id); } catch (issue) { setError(issue.message); }
    setBusy(''); if (count) onNotify(`${count} document${count === 1 ? '' : 's'} indexed for ${car.make} ${car.model}.`);
  }
  async function migrate(doc) {
    const carId = activeCar.id; setBusy(`Indexing ${doc.name}`); setError('');
    try {
      const name = /\.(txt|md)$/i.test(doc.name) ? doc.name : `${doc.name}.txt`;
      await ragApi(`cars/${carId}/documents?name=${encodeURIComponent(name)}`, { method: 'POST', body: doc.text, headers: { 'Content-Type': 'text/plain;charset=utf-8' } });
      onMigrated(doc.id); await reload(carId); onNotify('Browser document assigned and indexed for the selected car.');
    } catch (issue) { setError(issue.message); }
    finally { setBusy(''); }
  }
  async function open(doc) {
    setError(''); setBusy(`Opening ${doc.name}`);
    const carId = activeCar.id;
    try { const result = await ragApi(`cars/${carId}/documents/${doc.id}`); if (activeId.current === carId) setSelected(result); }
    catch (issue) { setError(issue.message); }
    finally { setBusy(''); }
  }
  async function deleteDoc(id) {
    const carId = activeCar.id; setBusy('Removing source'); setError('');
    try { await ragApi(`cars/${carId}/documents/${id}`, { method: 'DELETE' }); setSelected(null); setRemoving(null); await reload(carId); }
    catch (issue) { setError(issue.message); }
    finally { setBusy(''); }
  }
  async function deleteCar() {
    setBusy('Removing car'); setError('');
    try { await ragApi(`cars/${activeCar.id}`, { method: 'DELETE' }); await library.refresh(); onSelect(null); onNotify('Car and its indexed documents removed.'); }
    catch (issue) { setError(issue.message); }
    finally { setBusy(''); setRemoveCar(false); }
  }
  const matches = documents.filter(doc => doc.name.toLowerCase().includes(query.toLowerCase()));
  return <div className="rag-library">
    <section className="panel rag-summary"><div><span className="eyebrow">YOUR OFFLINE CAR LIBRARY</span><h2>Many cars. The right answer for yours.</h2><p className="muted">Choose a car and add manuals, prewritten answers, or both. Your answer mode selects which data is used for text and voice.</p></div><div className="rag-stats"><strong>{library.cars.length}<span>car configurations</span></strong><strong>{library.health?.documents || 0}<span>indexed documents</span></strong></div></section>
    <div className="rag-status-row"><span className={`connection-pill ${library.health?.ready ? 'ready-text' : ''}`}><span className="status-dot"/>{library.health?.ready ? 'Local RAG ready' : 'Optional RAG setup needed'}</span><span>MiniLM · SQLite · Qwen · No cloud</span><button className="text-button" onClick={() => void library.refresh()}>Refresh connection</button></div>
    {library.error && <div className="voice-error" role="alert">{library.error}</div>}
    {library.health && !library.health.ready && <div className="notice"><ShieldCheck size={18}/><span>For RAG + LLM, install models with <code>npm.cmd run rag:setup</code> and restart the app. Saved car answers work without those models.</span></div>}
    {!activeCar ? <section className="panel"><CarLibrary library={library} activeId={null} onSelect={onSelect} onNotify={onNotify}/></section> : <>
      <section className="panel rag-active"><div className="rag-car-heading"><div className="document-icon"><CarFront size={24}/></div><div><span className="eyebrow">ANSWERING FOR THIS CAR ONLY</span><h3>{activeCar.make} {activeCar.model} <span>{activeCar.year}</span></h3><p>{activeCar.variant} · {activeCar.market}</p></div></div><div className="rag-car-actions"><button className="secondary-button" disabled={!!busy} onClick={onManage}>Switch / add car <ArrowRight size={14}/></button><button className="icon-button danger-text" disabled={!!busy} aria-label="Remove selected car" onClick={() => setRemoveCar(true)}><Trash2 size={17}/></button></div></section>
      {removeCar && <div className="notice rag-confirm"><span>Remove {carLabel(activeCar)}, its saved answers, and all indexed documents?</span><button className="text-button danger-text" disabled={!!busy} onClick={deleteCar}>Remove car and data</button><button className="text-button" onClick={() => setRemoveCar(false)}>Keep car</button></div>}
      <SavedCarAnswers key={activeCar.id} car={activeCar} onChanged={library.refresh} onNotify={onNotify}/>
      <div className="content-toolbar"><div className="search-field"><Search size={17}/><input aria-label="Search indexed document names" placeholder="Find a manual or document" value={query} onChange={e => setQuery(e.target.value)}/></div><button className="primary-button" disabled={!!busy || !library.health?.retrieval_ready} onClick={() => upload.current.click()}><Upload size={16}/> Import manual</button><input ref={upload} hidden type="file" accept=".pdf,.txt,.md" multiple onChange={importFiles}/></div>
      <p className="panel-caption">PDF, TXT, Markdown · Up to 8 MB per file · Text PDFs supported; scanned pages need OCR · Confirm the manual matches this exact car.</p>
      {busy && <div className="rag-working" role="status"><LoaderCircle size={16} className="spin"/>{busy}…</div>}
      {error && <p className="voice-error" role="alert">{error}</p>}
      {loading ? <p className="rag-working" role="status">Loading this car’s sources…</p> : <div className="documents-grid">{matches.map(doc => <article className="panel document-card" key={doc.id}><div className="document-top"><div className="document-icon"><FileText size={23}/></div><span className="subtle-badge">Indexed</span></div><h3>{doc.name}</h3><p className="muted">{doc.chunks} passages · {doc.pages} text page{doc.pages === 1 ? '' : 's'}</p><p className="document-excerpt">Assigned to {activeCar.make} {activeCar.model} · {activeCar.year}</p><div className="document-bottom"><span>{doc.created.slice(0, 10)}</span><button disabled={!!busy} className="text-button" onClick={() => void open(doc)}>Read source <ArrowRight size={14}/></button></div></article>)}</div>}
      {!loading && !documents.length && <div className="empty-state panel"><BookOpen size={30}/><h3>Your car’s knowledge starts here.</h3><p>Import its owner’s manual or trusted service information.</p><button disabled={!!busy || !library.health?.retrieval_ready} className="secondary-button" onClick={() => upload.current.click()}><Upload size={15}/> Import the first manual</button></div>}
      {selected && <section className="panel source-reader"><div className="section-label"><span><FileText size={15}/>{selected.name}</span><button className="text-button" onClick={() => setSelected(null)}>Close source</button></div>{selected.chunks.map(chunk => <div className="source-passage" key={chunk.ordinal}><span>{chunk.page ? `Page ${chunk.page} · ` : ''}Passage {chunk.ordinal}</span><p>{chunk.text}</p></div>)}{removing === selected.id ? <div className="button-row"><span>Remove this source from the index?</span><button className="text-button danger-text" disabled={!!busy} onClick={() => void deleteDoc(selected.id)}>Remove source</button><button className="text-button" onClick={() => setRemoving(null)}>Keep source</button></div> : <button disabled={!!busy} className="text-button danger-text" onClick={() => setRemoving(selected.id)}><Trash2 size={14}/> Remove source</button>}</section>}
      {!!legacyDocuments.length && <section className="panel legacy-documents"><h3>Previously saved browser documents</h3><p className="muted">These have no vehicle assignment yet. Review each file, then assign it to the selected car to use it in answers.</p>{legacyDocuments.map(doc => <div key={doc.id}><FileText size={17}/><span>{doc.name}</span><button className="text-button" disabled={!!busy || !library.health?.retrieval_ready} onClick={() => void migrate(doc)}>Assign & index <ArrowRight size={13}/></button></div>)}</section>}
    </>}
  </div>;
}

export function AnswerSources({ message }) {
  if (!message.sources?.length && !message.mode) return null;
  const label = { generated: 'Answer from local AI', excerpts: 'Retrieved excerpts', insufficient: 'More evidence needed', saved: 'Saved car data · No AI', saved_missing: 'No saved answer · No AI' }[message.mode];
  return <div className="answer-evidence"><span className="answer-mode">{label}{message.carName ? ` · ${message.carName}` : ''}</span>{message.notice && <p className="rag-answer-notice">{message.notice}</p>}{message.sources?.map(source => <details key={`${source.document_id}-${source.chunk}`}><summary><FileText size={13}/><span>[{source.citation}] {source.name} · {source.kind === 'saved_answer' ? 'saved entry' : source.page ? `page ${source.page}` : `passage ${source.chunk}`}</span></summary><p>{source.text}</p></details>)}</div>;
}
