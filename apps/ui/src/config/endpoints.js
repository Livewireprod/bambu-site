export const GATEWAY_HTTP =
  import.meta.env.VITE_GATEWAY_HTTP || "http://localhost:9980";

export const GATEWAY_WS =
  import.meta.env.VITE_GATEWAY_WS || "ws://localhost:9980/events";
