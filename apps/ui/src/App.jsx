import { usePrinters } from "./hooks/usePrinters";

export default function App() {
  const { printers, connected } = usePrinters();

  return (
    <div style={{ fontFamily: "system-ui", padding: 16 }}>
      <h1>Bambu UI</h1>
      <p>
        WS: {connected ? "connected ✅" : "disconnected ❌"}
      </p>

      {printers.length === 0 ? (
        <p>No printers yet.</p>
      ) : (
        <div style={{ display: "grid", gap: 12, maxWidth: 520 }}>
          {printers.map((p) => (
            <div
              key={p.id}
              style={{
                border: "1px solid #3333",
                borderRadius: 12,
                padding: 12,
              }}
            >
              <strong>{p.name}</strong>
              <div>Status: {p.status}</div>
              <div>Online: {String(p.online)}</div>
              <div>Progress: {p.progress ?? 0}%</div>
              <div>
                Temps: nozzle {p.temps?.nozzle ?? "-"} / bed {p.temps?.bed ?? "-"}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
