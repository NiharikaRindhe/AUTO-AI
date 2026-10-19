export const ANSWER_MODES = {
  rag: { label: 'RAG + LLM', description: 'Search this car’s manuals and generate an answer locally.' },
  saved: { label: 'Saved car data (no AI)', description: 'Use prewritten answers. No document search or language model.' },
};

export function normalizeAnswerMode(value) {
  return value === 'saved' ? 'saved' : 'rag';
}

export function answerModeChange(current, next) {
  const mode = normalizeAnswerMode(next);
  return { mode, cancelPending: normalizeAnswerMode(current) !== mode };
}
