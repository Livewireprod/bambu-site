import mqtt from "mqtt";

export function connectPrinterMQTT({ serial, accessCode, ip }, onMessage) {
  const url = `mqtts://${ip}:8883`;

  const client = mqtt.connect(url, {
    username: "bblp",
    password: String(accessCode).trim(),
    rejectUnauthorized: false, // Bambu uses self-signed certs
    keepalive: 30,
    reconnectPeriod: 3000,
    connectTimeout: 10000,
  });

  let didProbe = false;

  client.on("connect", () => {
    console.log(`[MQTT] Connected to ${serial} @ ${ip}:8883`);
    // subscribe broadly while we're mapping fields
    client.subscribe(`device/${serial}/#`, (err) => {
      if (err) console.error("[MQTT] Subscribe error:", err.message);
    });
  });

  client.on("message", (topic, payload) => {
    let msg;
    try {
      msg = JSON.parse(payload.toString("utf8"));
    } catch (e) {
      console.log("[MQTT] Non-JSON payload on", topic);
      return;
    }

    // 🔎 PROGRESS PROBE (prints once)
    if (!didProbe) {
      didProbe = true;
      const p = msg?.print || {};
      console.log("\n=== PROGRESS PROBE ===");
      console.log("Topic:", topic);
      console.log(
        JSON.stringify(
          {
            // common progress-ish fields
            print_percent: p.print_percent,
            mc_percent: p.mc_percent,
            progress: p.progress,
            percent: p.percent,

            // layer fallback
            layer_num: p.layer_num,
            total_layer_num: p.total_layer_num,

            // time info
            remain_time: p.remain_time,
            print_time: p.print_time,

            // state info
            gcode_state: p.gcode_state,
            gcode_state_str: p.gcode_state_str,

            // temp fields (so we can confirm current vs target)
            nozzle_temper: p.nozzle_temper,
            bed_temper: p.bed_temper,
            nozzle_target_temper: p.nozzle_target_temper,
            bed_target_temper: p.bed_target_temper,
          },
          null,
          2
        )
      );
    }

    // normal pipeline
    onMessage(msg);
  });

  client.on("error", (err) => {
    console.error("[MQTT] Error", err.message);
  });

  client.on("close", () => {
    console.log("[MQTT] Connection closed");
  });

  return client;
}
