export function parsePrinterReport(report) {
  const p = report?.print || {};

  return {
    status: p.gcode_state || "unknown",
    progress: Math.round((p.print_percent ?? 0)),
    temps: {
      nozzle: p.nozzle_temper,
      bed: p.bed_temper
    },
    updatedAt: new Date().toISOString()
  };
}
