import { useState } from "react";
import { Link } from "react-router-dom";
import { api, euro, when } from "../api";
import { Badge } from "../components/Badge";
import type { Event, Item, Status } from "../types";

export function Dashboard({
  status,
  items,
  events,
  demo,
  refresh,
}: {
  status: Status | null;
  items: Item[];
  events: Event[];
  demo: boolean;
  refresh: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [spec, setSpec] = useState("");

  const run = async (key: string, path: string, body?: unknown) => {
    setBusy(key);
    setError(null);
    try {
      await api(path, {
        method: "POST",
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      refresh();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(null);
    }
  };

  const excluded = items.filter(
    (item) => item.state === "open" && item.resolutionStatus === "excluded",
  );
  const review = items.filter(
    (item) =>
      item.state === "open" &&
      item.mappingId == null &&
      item.resolutionStatus != null &&
      !["ignored", "excluded", "resolved"].includes(item.resolutionStatus),
  );
  const cart = status?.cart;
  const total = cart?.totals.grandTotal;
  const minimum = cart?.checkout?.minimumOrder;

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Painel</h1>
          <p className="muted">
            {status?.bring.listName ? `Lista “${status.bring.listName}”` : "A ligar à lista…"}
            {status?.dryRun && " · modo de ensaio"}
            {status?.paused && " · em pausa"}
          </p>
        </div>
        <div className="row gap">
          <button
            type="button"
            className="ghost"
            onClick={() => run("sync", "/api/actions/sync")}
            disabled={busy !== null}
          >
            {busy === "sync" ? "A sincronizar…" : "Sincronizar agora"}
          </button>
          <button
            type="button"
            onClick={() =>
              run("pause", status?.paused ? "/api/actions/resume" : "/api/actions/pause")
            }
            disabled={busy !== null}
          >
            {status?.paused ? "Retomar" : "Pausar"}
          </button>
        </div>
      </header>

      {(status?.lastPollError || status?.continente.error) && (
        <div className="alert error">
          <strong>Erro:</strong> {status?.lastPollError ?? status?.continente.error}
        </div>
      )}
      {error && <div className="alert error">{error}</div>}
      {status?.pendingCheckout ? (
        <div className="alert info">
          Há um pedido à espera de confirmação.{" "}
          <Link to="/checkout">Marcar itens na lista Bring</Link>.
        </div>
      ) : null}

      <section className="stats">
        <Stat label="Na lista" value={status?.counts.open ?? 0} />
        <Stat label="No carrinho" value={status?.counts.mapped ?? 0} tone="green" />
        <Stat
          label="A rever"
          value={review.length}
          tone={review.length > 0 ? "amber" : undefined}
          to="/queue"
        />
        <Stat
          label="Compras tu"
          value={excluded.length}
          tone={excluded.length > 0 ? "gray" : undefined}
        />
        <Stat label="Total" value={euro(total)} />
      </section>

      <div className="grid two">
        <section className="card">
          <div className="card-head">
            <h2>Carrinho Continente</h2>
            <span className="muted small">{when(status?.continente.lastCartAt)}</span>
          </div>
          {cart?.items.length ? (
            <table className="table">
              <thead>
                <tr>
                  <th>Produto</th>
                  <th className="num">Qtd</th>
                  <th className="num">Total</th>
                </tr>
              </thead>
              <tbody>
                {cart.items.map((line) => (
                  <tr key={`${line.productId}-${line.name}`}>
                    <td>{line.name}</td>
                    <td className="num">{line.quantity}</td>
                    <td className="num">{euro(line.lineTotal)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={2}>
                    {minimum && total != null && total < minimum
                      ? `Faltam ${euro(minimum - total)} para o mínimo`
                      : "Total"}
                  </td>
                  <td className="num">
                    <strong>{euro(total)}</strong>
                  </td>
                </tr>
              </tfoot>
            </table>
          ) : (
            <p className="empty">O carrinho está vazio. Adiciona algo à lista Bring.</p>
          )}
        </section>

        <section className="card">
          <div className="card-head">
            <h2>Para comprares tu</h2>
            <Badge kind="excluded" />
          </div>
          {excluded.length === 0 ? (
            <p className="empty">
              Nada por aqui. Carne, peixe, fruta e legumes ficam sempre fora do carrinho.
            </p>
          ) : (
            <ul className="plain">
              {excluded.map((item) => (
                <li key={item.uuid}>
                  <span>{item.itemId}</span>
                  <span className="muted small">{item.reviewReason}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {demo && (
        <section className="card demo">
          <div className="card-head">
            <h2>Modo demo</h2>
            <span className="badge purple">sem contas ligadas</span>
          </div>
          <p className="muted">
            Adiciona um item à lista e deixa o motor resolvê-lo. “Simular pedido” esvazia o carrinho
            e cria uma encomenda, para veres o checkout a marcar itens no Bring.
          </p>
          <form
            className="row gap"
            onSubmit={(event) => {
              event.preventDefault();
              if (!name.trim()) return;
              void run("add", "/api/demo/items", { name, specification: spec }).then(() => {
                setName("");
                setSpec("");
              });
            }}
          >
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="ex.: Iogurte grego"
              aria-label="Item"
            />
            <input
              value={spec}
              onChange={(event) => setSpec(event.target.value)}
              placeholder="quantidade"
              aria-label="Quantidade"
              className="short"
            />
            <button type="submit" disabled={busy !== null}>
              Adicionar
            </button>
            <button
              type="button"
              className="ghost"
              onClick={() => run("order", "/api/demo/order")}
              disabled={busy !== null}
            >
              {busy === "order" ? "A simular…" : "Simular pedido"}
            </button>
          </form>
        </section>
      )}

      <section className="card">
        <div className="card-head">
          <h2>Últimos eventos</h2>
          <Link className="link" to="/events">
            Ver todos
          </Link>
        </div>
        <ul className="events">
          {events.slice(0, 6).map((event) => (
            <li key={event.id}>
              <span
                className={`dot ${event.level === "error" ? "bad" : event.level === "warn" ? "warn" : "ok"}`}
              />
              <span className="event-kind">{event.kind}</span>
              <span>{event.message}</span>
              <time className="muted small">{when(event.at)}</time>
            </li>
          ))}
          {events.length === 0 && <li className="empty">Sem eventos ainda.</li>}
        </ul>
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
  to,
}: {
  label: string;
  value: number | string;
  tone?: string;
  to?: string;
}) {
  const content = (
    <div className={`stat ${tone ?? ""}`}>
      <span className="muted small">{label}</span>
      <strong>{value}</strong>
    </div>
  );
  return to ? <Link to={to}>{content}</Link> : content;
}
