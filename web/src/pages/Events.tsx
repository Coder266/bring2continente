import { useEffect, useState } from "react";
import { api, when } from "../api";
import type { Event } from "../types";

export function Events({ version }: { version: number }) {
  const [events, setEvents] = useState<Event[]>([]);
  const [level, setLevel] = useState("all");
  const [error, setError] = useState<string | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: version is a refresh trigger
  useEffect(() => {
    api<{ events: Event[] }>("/api/events?limit=300")
      .then((data) => setEvents(data.events))
      .catch((err) => setError(String(err)));
  }, [version]);

  const filtered = events.filter((event) => level === "all" || event.level === level);

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Eventos</h1>
          <p className="muted">Tudo o que o motor fez, e porquê.</p>
        </div>
        <select value={level} onChange={(event) => setLevel(event.target.value)}>
          <option value="all">Tudo</option>
          <option value="info">Info</option>
          <option value="warn">Avisos</option>
          <option value="error">Erros</option>
        </select>
      </header>

      {error && <div className="alert error">{error}</div>}

      <section className="card">
        <table className="table">
          <thead>
            <tr>
              <th>Quando</th>
              <th>Tipo</th>
              <th>Mensagem</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((event) => (
              <tr key={event.id}>
                <td className="muted small">{when(event.at)}</td>
                <td>
                  <span
                    className={`badge ${event.level === "error" ? "red" : event.level === "warn" ? "amber" : "gray"}`}
                  >
                    {event.kind}
                  </span>
                </td>
                <td>
                  {event.message}
                  {event.data ? (
                    <details>
                      <summary className="muted tiny">dados</summary>
                      <pre>{JSON.stringify(event.data, null, 2)}</pre>
                    </details>
                  ) : null}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={3} className="empty">
                  Sem eventos.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
