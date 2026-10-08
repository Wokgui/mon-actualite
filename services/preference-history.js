// Local preference snapshots only: no article catalogue or credentials.
export function createPreferenceHistory(initial, storage, limit = 50) {
  const key = 'news-preference-history-v1';
  const encode = value => JSON.stringify(value);
  let present = encode(initial), past = [], future = [], group = null;
  try {
    const saved = JSON.parse(storage.getItem(key) || 'null');
    if (saved?.present === present && Array.isArray(saved.past) && Array.isArray(saved.future)) {
      const valid = value => { try { return typeof value === 'string' && !!JSON.parse(value)?.settings; } catch { return false; } };
      past = saved.past.filter(valid).slice(-limit); future = saved.future.filter(valid).slice(-limit);
    }
  } catch {}
  const save = () => { try { storage.setItem(key, JSON.stringify({ present, past, future })); } catch {} };
  return {
    get canUndo() { return past.length > 0; }, get canRedo() { return future.length > 0; },
    finishGroup() { group = null; },
    record(value, nextGroup = null) {
      const next = encode(value); if (next === present) return;
      if (!nextGroup || nextGroup !== group) { past.push(present); past = past.slice(-limit); }
      present = next; future = []; group = nextGroup; save();
    },
    undo() { if (!past.length) return null; future.push(present); present = past.pop(); group = null; save(); return JSON.parse(present); },
    redo() { if (!future.length) return null; past.push(present); present = future.pop(); group = null; save(); return JSON.parse(present); }
  };
}
