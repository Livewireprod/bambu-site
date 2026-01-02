const isHttps = location.protocol === "https:";

export const GATEWAY_HTTP = ""; // same origin

export const GATEWAY_WS = `${isHttps ? "wss" : "ws"}://${location.host}/events`;

// https://github.com/Livewireprod/bambu-site