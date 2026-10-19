import React, { useEffect, useRef, useState } from 'react';
import { Database, Edit3, Plus, Save, Trash2, X } from 'lucide-react';
import { ragApi } from '../rag/api.js';

const empty = { question: '', answer: '', source: '', aliases: '' };

export default function SavedCarAnswers({ car, onChanged, onNotify }) {
  const [entries, setEntries] = useState([]);
  const [form, setForm] = useState(empty);
  const [editing, setEditing] = useState(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [removing, setRemoving] = useState(null);
  const [filter, setFilter] = useState('');
  const current = useRef(car.id); current.current = car.id;
  const changed = useRef(onChanged); changed.current = onChanged;

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setEntries([]); setError(''); setOpen(false); setEditing(null); setFilter(''); setRemoving(null);
    ragApi(`cars/${car.id}/answers`, { signal: controller.signal }).then(result => setEntries(result.answers))
      .catch(issue => { if (issue.name !== 'AbortError') setError(issue.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [car.id]);

  async function reload(carId) {
    const result = await ragApi(`cars/${carId}/answers`);
    if (current.current === carId) setEntries(result.answers);
    await changed.current();
  }
  function edit(entry) {
    setForm({ ...entry, aliases: entry.aliases.join('\n') }); setEditing(entry.id); setOpen(true); setError('');
  }
  async function save(event) {
    event.preventDefault(); const carId = car.id;
    setBusy(true); setError('');
    try {
      await ragApi(`cars/${carId}/answers${editing ? `/${editing}` : ''}`, {
        method: editing ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: form.question.trim(), answer: form.answer.trim(), source: form.source.trim(),
          aliases: form.aliases.split('\n').map(item => item.trim()).filter(Boolean) }),
      });
      if (current.current === carId) { setForm(empty); setEditing(null); setOpen(false); }
      await reload(carId); onNotify('Prewritten car answer saved. It is ready in Saved car data mode.');
    } catch (issue) { if (current.current === carId) setError(issue.message); }
    finally { if (current.current === carId) setBusy(false); }
  }
  async function remove(id) {
    const carId = car.id; setBusy(true); setError('');
    try {
      await ragApi(`cars/${carId}/answers/${id}`, { method: 'DELETE' });
      if (current.current === carId) { setRemoving(null); if (editing === id) { setEditing(null); setOpen(false); } }
      await reload(carId); onNotify('Saved answer removed.');
    } catch (issue) { if (current.current === carId) setError(issue.message); }
    finally { if (current.current === carId) setBusy(false); }
  }
  const shown = entries.filter(entry => `${entry.question} ${entry.answer} ${entry.source}`.toLowerCase().includes(filter.toLowerCase()));
  return <section className="panel saved-car-answers">
    <div className="section-label"><span><Database size={16}/> SAVED CAR ANSWERS</span><span className="subtle-badge">No AI needed</span></div>
    <div className="saved-answer-heading"><div><h2>Write once. Hear it when you need it.</h2><p className="muted">Prewritten answers for {car.make} {car.model}, {car.year}. These are the hardcoded option; no embeddings or LLM are used to answer.</p></div><button className="secondary-button" disabled={busy} onClick={() => { setForm(empty); setEditing(null); setError(''); setOpen(true); }}><Plus size={15}/> Add an answer</button></div>
    <p className="panel-caption">Use information checked against this exact variant and market. The app records your source reference; it does not verify the information automatically.</p>
    {error && <div className="voice-error" role="alert">{error}</div>}
    {open && <form className="editor-form saved-answer-editor" onSubmit={save}>
      <div className="section-label"><h3>{editing ? 'Edit saved answer' : 'Add saved answer'}</h3><button type="button" className="icon-button" disabled={busy} aria-label="Close saved answer editor" onClick={() => setOpen(false)}><X size={18}/></button></div>
      <label>Question<input required maxLength={600} value={form.question} placeholder="e.g. What is the fuel tank capacity?" onChange={e => setForm({ ...form, question: e.target.value })}/></label>
      <label>Prewritten answer<textarea required rows={3} maxLength={1400} value={form.answer} placeholder="Enter the exact answer from a trusted source. Include units and conditions." onChange={e => setForm({ ...form, answer: e.target.value })}/></label>
      <label>Source reference<input required maxLength={300} value={form.source} placeholder="e.g. Owner’s manual, exact edition, page or section" onChange={e => setForm({ ...form, source: e.target.value })}/></label>
      <label>Alternative questions <span className="muted">(optional, one per line, up to 20)</span><textarea rows={3} maxLength={12020} value={form.aliases} placeholder={'How much fuel does the tank hold?\nTell me the fuel tank capacity.'} onChange={e => setForm({ ...form, aliases: e.target.value })}/></label>
      <p className="panel-caption">Questions and alternatives match ignoring capitalization, punctuation, and extra spaces. Add other phrasings explicitly; there is no AI guessing or automatic RAG fallback.</p>
      <button className="primary-button" disabled={busy || form.aliases.split('\n').filter(line => line.trim()).length > 20}><Save size={15}/>{busy ? 'Saving…' : 'Save answer'}</button>
    </form>}
    {loading ? <p className="rag-working" role="status">Loading saved answers…</p> : <>
      {!!entries.length && <label className="saved-answer-search">Find a saved answer<input aria-label="Search saved car answers" value={filter} onChange={e => setFilter(e.target.value)} placeholder="Search questions, answers, or sources"/></label>}
      <div className="saved-answer-list">{shown.map(entry => <article key={entry.id}>
        <div className="saved-answer-title"><h3>{entry.question}</h3><div><button className="icon-button" aria-label={`Edit answer: ${entry.question}`} disabled={busy} onClick={() => edit(entry)}><Edit3 size={16}/></button><button className="icon-button danger-text" aria-label={`Remove answer: ${entry.question}`} disabled={busy} onClick={() => setRemoving(entry.id)}><Trash2 size={16}/></button></div></div>
        <p>{entry.answer}</p><small>Source: {entry.source}</small>{!!entry.aliases.length && <details><summary>{entry.aliases.length} alternative question{entry.aliases.length === 1 ? '' : 's'}</summary><ul>{entry.aliases.map(alias => <li key={alias}>{alias}</li>)}</ul></details>}
        {removing === entry.id && <div className="notice rag-confirm"><span>Remove this prewritten answer?</span><button className="text-button danger-text" disabled={busy} onClick={() => void remove(entry.id)}>Remove answer</button><button className="text-button" onClick={() => setRemoving(null)}>Keep answer</button></div>}
      </article>)}</div>
      {!entries.length && <div className="saved-answer-empty"><Database size={24}/><p>No prewritten answers for this car yet. Add your first answer with its source.</p></div>}
      {!!entries.length && !shown.length && <p className="panel-caption">No saved answers match this search.</p>}
    </>}
  </section>;
}
