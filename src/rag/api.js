export async function ragApi(path, options = {}) {
  let response;
  try { response = await fetch(`/api/rag/${path}`, options); }
  catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new Error('The local car library is unavailable. Start or restart npm.cmd run dev:all.');
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.detail?.message || 'The local car library request failed. Check the backend and try again.');
  }
  return response.json();
}

export function queryCar(carId, question, signal, answerMode = 'rag') {
  if (!['rag', 'saved'].includes(answerMode)) throw new Error('Choose RAG + LLM or Saved car data.');
  return ragApi('query', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ car_id: carId, question, generate: answerMode === 'rag', answer_mode: answerMode }), signal });
}

export const carLabel = car => `${car.make} ${car.model} · ${car.year} · ${car.variant} · ${car.market}`;
