import { useEffect, useRef } from 'react';

/**
 * Subscribes to the Server-Sent Events stream. EventSource reconnects by itself,
 * so if the replica holding this connection dies the page moves to another one.
 */
export function useEvents(handlers, enabled = true) {
  const latest = useRef(handlers);
  latest.current = handlers;

  useEffect(() => {
    if (!enabled) return undefined;
    const source = new EventSource('/api/events');
    const types = Object.keys(latest.current);
    const listeners = types.map((type) => {
      const listener = (message) => latest.current[type]?.(JSON.parse(message.data));
      source.addEventListener(type, listener);
      return [type, listener];
    });
    return () => {
      listeners.forEach(([type, listener]) => source.removeEventListener(type, listener));
      source.close();
    };
  }, [enabled]);
}
