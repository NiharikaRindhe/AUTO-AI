import { useCallback, useEffect, useState } from 'react';
import { ragApi } from './api.js';

export function useCarLibrary() {
  const [cars, setCars] = useState([]);
  const [health, setHealth] = useState(null);
  const [error, setError] = useState('');
  const refresh = useCallback(async signal => {
    try {
      const [catalog, status] = await Promise.all([ragApi('cars', { signal }), ragApi('health', { signal })]);
      if (signal?.aborted) return;
      setCars(catalog.cars); setHealth(status); setError('');
    } catch (issue) {
      if (issue.name !== 'AbortError') { setError(issue.message); setHealth(null); }
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    const timer = setInterval(() => void refresh(controller.signal), 30000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [refresh]);
  return { cars, health, error, refresh };
}
