import { useEffect, useRef, useState } from "react";
import { GATEWAY_HTTP, GATEWAY_WS } from "../config/endpoints";

export function usePrinters() {
  const [printers, setPrinters] = useState([]);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef(null);

  // initial fetch (works even if WS blocked)
  useEffect(() => {
    fetch(`${GATEWAY_HTTP}/printers`)
      .then((r) => r.json())
      .then((d) => setPrinters(Array.isArray(d?.printers) ? d.printers : []))
      .catch(() => {});
  }, []);

  // websocket for realtime
  useEffect(() => {
    const ws = new WebSocket(GATEWAY_WS);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onerror = () => setConnected(false);

    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        if (msg.type === "printers.list" || msg.type === "printers.update") {
          if (Array.isArray(msg.printers)) setPrinters(msg.printers);
        }
      } catch {}
    };

    return () => ws.close();
  }, []);

  return { printers, connected };
}
