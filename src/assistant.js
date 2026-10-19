// Shared text and voice response handler. This is deterministic retrieval, not an LLM.
export function answerQuestion(question, { profile, documents, notes, hasMusic = false, useRag = false }) {
  const text = question.trim();
  const lower = text.toLowerCase();
  if (/^(hi|hello|hey|नमस्ते|हेलो)[.!\s]*$/u.test(lower)) {
    return { text: `Hello! I’m your AutoAI co-pilot. Ask about your ${profile.model}, your service records, or your local music.` };
  }
  if (/^(please\s+)?(call|message|sms|whatsapp|send\s+(a\s+)?(message|sms))\b|^कॉल|^संदेश/u.test(lower)) {
    return { text: 'A phone connection is needed to do that. This web app cannot place calls or send messages. No action has been sent.' };
  }
  if (/^(please\s+)?(play|pause|resume|next|previous|skip|volume|increase.*volume|decrease.*volume|turn.*volume)\b/u.test(lower)
      || /^(please\s+)?stop(?!.*\b(engine|car|vehicle)\b)/u.test(lower)
      || /^how do i (play|add|listen to).*\b(music|songs?|playlist)\b/u.test(lower)
      || /^(गाना|संगीत|आवाज)/u.test(lower)) {
    if (/pause|stop|बंद/u.test(lower)) return { text: 'Music paused.', action: 'music_pause' };
    if (!hasMusic) return { text: 'Choose audio files in Music first. They will play directly from your device without internet.', action: 'open_music' };
    if (/next|अगला/u.test(lower)) return { text: 'Playing the next track.', action: 'music_next' };
    if (/previous|back|पिछला/u.test(lower)) return { text: 'Playing the previous track.', action: 'music_previous' };
    if (/volume.*(up|increase)|louder/u.test(lower)) return { text: 'Volume increased.', action: 'volume_up' };
    if (/volume.*(down|decrease)|quieter/u.test(lower)) return { text: 'Volume decreased.', action: 'volume_down' };
    return { text: 'Playing your local music.', action: 'music_play' };
  }
  if (/\b(privacy|private|offline)\b/.test(lower) || lower.includes('stored locally')) {
    return { text: 'Your profile and service notes stay in this browser. The car knowledge library and its document index are stored in SQLite on this computer. Speech and AI answers are processed by the local backend, without a cloud service. Temporary voice files are deleted after processing.', source: 'AutoAI local processing guide' };
  }
  if (/\b(my (next |last )?service|my maintenance|service (history|records)|next service)\b/u.test(lower)) {
    return { text: notes.length ? `You have ${notes.length} saved maintenance ${notes.length === 1 ? 'record' : 'records'}. Your latest record is ${notes[0].title}, dated ${notes[0].date}. The maintenance schedule still needs your verified owner’s manual.` : 'You have no saved service records yet. Add your last service in Maintenance. I need a verified schedule and your service history before calculating when your next service is due.', source: 'Your local maintenance records' };
  }
  if (/^(tell me about my car|what is my car|show (me )?(my )?(car|vehicle) details|vehicle details|car model)[.!?\s]*$/u.test(lower)) {
    return { text: `Your saved profile is a ${profile.year} ${profile.model}, ${profile.variant}. ${profile.mileage === '' ? 'The odometer has not been recorded.' : `The recorded odometer is ${Number(profile.mileage).toLocaleString('en-IN')} kilometres.`} ${profile.sample ? 'This is a sample profile. Update it to match your car.' : 'These details were entered manually; they are not live vehicle readings.'}`, source: 'Your saved vehicle profile' };
  }
  if (useRag) return { rag: true };
  const stop = new Set(['what', 'which', 'where', 'when', 'does', 'about', 'please', 'your', 'with', 'have', 'that', 'this', 'from', 'should', 'would', 'could', 'tell', 'know', 'there', 'their', 'they', 'into', 'need']);
  const words = [...new Set(lower.match(/[\p{L}\p{N}]+/gu) || [])].filter(word => word.length > 2 && !stop.has(word));
  const candidates = documents.flatMap(doc => doc.text.split(/\n\s*\n|(?<=[.!?])\s+/).map(section => ({ section, doc, score: words.filter(word => section.toLowerCase().includes(word)).length }))).filter(result => result.score > 0).sort((a, b) => b.score - a.score);
  const match = candidates[0];
  if (match) return { text: `Here is a matching excerpt from your saved document: “${match.section.slice(0, 850)}” This is a keyword match, not a diagnosis. Check that the document matches your exact vehicle.`, source: match.doc.name };
  return { text: `I don’t have verified information to answer that for your ${profile.model}. Add a matching text manual in Knowledge, then ask again. Answers currently use local document search; a generative AI model is not connected.` };
}
