export interface Logger {
  debug(message: string, data?: unknown): void;
  info(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
  error(message: string, data?: unknown): void;
}

export function consoleLogger(level: string): Logger {
  const order = ["debug", "info", "warn", "error"];
  const min = Math.max(0, order.indexOf(level));
  const emit = (lvl: "debug" | "info" | "warn" | "error", message: string, data?: unknown) => {
    if (order.indexOf(lvl) < min) return;
    const line = `[${new Date().toISOString()}] ${lvl.toUpperCase()} ${message}`;
    if (data === undefined) console[lvl](line);
    else console[lvl](line, data);
  };
  return {
    debug: (m, d) => emit("debug", m, d),
    info: (m, d) => emit("info", m, d),
    warn: (m, d) => emit("warn", m, d),
    error: (m, d) => emit("error", m, d),
  };
}

export const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};
