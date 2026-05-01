import { useEffect, useRef, useCallback, useState } from 'react';
import type { GraphData } from './types';
import { createWebSocket } from './api';

export function useWebSocket(onGraph: (data: GraphData) => void) {
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const reconnectTimeoutRef = useRef<number>();
  const pingIntervalRef = useRef<number>();
  const lastMessageTimeRef = useRef<number>(Date.now());
  // Use ref to always have latest callback without recreating WebSocket
  const onGraphRef = useRef(onGraph);
  onGraphRef.current = onGraph;

  const connect = useCallback(() => {
    // Clean up existing connection
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    const ws = createWebSocket();

    ws.onopen = () => {
      setConnected(true);
      lastMessageTimeRef.current = Date.now();
    };

    ws.onmessage = (event) => {
      lastMessageTimeRef.current = Date.now();
      try {
        const message = JSON.parse(event.data);
        if (message.type === 'graph') {
          onGraphRef.current(message.data);
        }
      } catch (e) {
        console.error('WebSocket message parse error:', e);
      }
    };

    ws.onclose = () => {
      setConnected(false);
      wsRef.current = null;
      // Reconnect after delay
      reconnectTimeoutRef.current = window.setTimeout(connect, 2000);
    };

    ws.onerror = () => {
      // Error will trigger onclose, which handles reconnection
    };

    wsRef.current = ws;
  }, []);

  useEffect(() => {
    connect();

    // Check connection health every 5 seconds
    pingIntervalRef.current = window.setInterval(() => {
      const now = Date.now();
      const timeSinceLastMessage = now - lastMessageTimeRef.current;

      // If no message received for 10 seconds, reconnect
      if (timeSinceLastMessage > 10000) {
        console.log('WebSocket stale, reconnecting...');
        if (wsRef.current) {
          wsRef.current.close();
        }
      }
    }, 5000);

    // Reconnect when tab becomes visible again
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        const timeSinceLastMessage = Date.now() - lastMessageTimeRef.current;
        if (timeSinceLastMessage > 5000 || wsRef.current?.readyState !== WebSocket.OPEN) {
          console.log('Tab visible, reconnecting WebSocket...');
          connect();
        }
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [connect]);

  return { connected };
}
