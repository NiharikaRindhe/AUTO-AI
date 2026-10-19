import React, { useId } from 'react';
import { Database, Sparkles } from 'lucide-react';
import { ANSWER_MODES } from './modes.js';

export default function AnswerModeSelector({ mode, onChange, health }) {
  const group = useId();
  return <fieldset className="answer-mode-selector panel">
    <legend>Answer mode</legend>
    <div className="answer-mode-options">{Object.entries(ANSWER_MODES).map(([value, item]) => {
      const Icon = value === 'rag' ? Sparkles : Database;
      return <label key={value} className={`answer-mode-option ${mode === value ? 'selected' : ''}`}>
        <input type="radio" name={group} value={value} checked={mode === value} onChange={() => onChange(value)}/>
        <Icon size={21}/><span><strong>{item.label}</strong><small>{item.description}</small></span>
      </label>;
    })}</div>
    <p>{mode === 'saved'
      ? 'Hardcoded answers are stored for each exact car. Add them in Knowledge → Saved car answers. Voice and music controls remain available.'
      : 'Answers use only the selected car’s indexed manuals. Sources appear below each answer.'}</p>
    {mode === 'rag' && health && !health.ready && <p className="mode-setup-note">RAG models need setup. Run npm.cmd run rag:setup and restart the backend. Your selected mode will not change automatically.</p>}
  </fieldset>;
}
