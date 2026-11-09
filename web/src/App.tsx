import { useCallback, useEffect, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { api } from "./api";
import { Layout } from "./components/Layout";
import { Checkout } from "./pages/Checkout";
import { Dashboard } from "./pages/Dashboard";
import { Events } from "./pages/Events";
import { Login } from "./pages/Login";
import { Mappings } from "./pages/Mappings";
import { Queue } from "./pages/Queue";
import { Rules } from "./pages/Rules";
import type { Event, Item, Status } from "./types";

export function App() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [demo, setDemo] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [version, setVersion] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    Promise.all([
      api<Status>("/api/status"),
      api<{ items: Item[] }>("/api/items"),
      api<{ events: Event[] }>("/api/events?limit=60"),
    ])
      .then(([nextStatus, nextItems, nextEvents]) => {
        setStatus(nextStatus);
        setItems(nextItems.items);
        setEvents(nextEvents.events);
        setLoadError(null);
        setVersion((v) => v + 1);
      })
      .catch((error) => setLoadError(String(error)));
  }, []);

  useEffect(() => {
    api<{ authenticated: boolean; demo?: boolean }>("/api/session")
      .then((session) => {
        setAuthed(session.authenticated);
        setDemo(Boolean(session.demo));
      })
      .catch(() => setAuthed(false));
    const onUnauthorized = () => setAuthed(false);
    window.addEventListener("b2c:unauthorized", onUnauthorized);
    return () => window.removeEventListener("b2c:unauthorized", onUnauthorized);
  }, []);

  useEffect(() => {
    if (!authed) return;
    refresh();
    const timer = setInterval(refresh, 10_000);
    return () => clearInterval(timer);
  }, [authed, refresh]);

  if (authed === null) {
    return <div className="boot">A carregar…</div>;
  }

  if (!authed) {
    return (
      <Login
        hint={demo ? "Demo: a palavra-passe é demo" : null}
        onLogin={() => {
          setAuthed(true);
          setTimeout(refresh, 100);
        }}
      />
    );
  }

  return (
    <BrowserRouter>
      {loadError && <div className="global-error">{loadError}</div>}
      <Routes>
        <Route
          element={
            <Layout
              status={status}
              onLogout={() => {
                void api("/api/logout", { method: "POST" }).finally(() => setAuthed(false));
              }}
            />
          }
        >
          <Route
            index
            element={
              <Dashboard
                status={status}
                items={items}
                events={events}
                demo={demo}
                refresh={refresh}
              />
            }
          />
          <Route path="queue" element={<Queue items={items} refresh={refresh} />} />
          <Route path="mappings" element={<Mappings version={version} />} />
          <Route path="checkout" element={<Checkout refresh={refresh} />} />
          <Route path="rules" element={<Rules />} />
          <Route path="events" element={<Events version={version} />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
