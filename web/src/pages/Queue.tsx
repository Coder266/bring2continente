import { useState } from "react";
import { api } from "../api";
import { Badge } from "../components/Badge";
import { CandidateCard, ProductCard } from "../components/ProductCard";
import type { Candidates, Item } from "../types";

export function Queue({ items, refresh }: { items: Item[]; refresh: () => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<Record<string, Candidates>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pending = items.filter(
    (item) =>
      item.state === "open" &&
      item.mappingId == null &&
      item.resolutionStatus != null &&
      !["ignored", "excluded", "resolved"].includes(item.resolutionStatus),
  );
  const excluded = items.filter(
    (item) => item.state === "open" && item.resolutionStatus === "excluded",
  );
  const ignored = items.filter(
    (item) => item.state === "open" && item.resolutionStatus === "ignored",
  );

  const load = async (item: Item) => {
    setOpen(open === item.uuid ? null : item.uuid);
    if (candidates[item.uuid] || open === item.uuid) return;
    setBusy(item.uuid);
    setError(null);
    try {
      const data = await api<Candidates>(`/api/items/${item.uuid}/candidates`);
      setCandidates((prev) => ({ ...prev, [item.uuid]: data }));
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(null);
    }
  };

  const act = async (item: Item, path: string, body?: unknown) => {
    setBusy(item.uuid);
    setError(null);
    try {
      await api(path, {
        method: "POST",
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      setCandidates((prev) => {
        const copy = { ...prev };
        delete copy[item.uuid];
        return copy;
      });
      refresh();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Rever</h1>
          <p className="muted">
            Itens que o motor não conseguiu resolver com segurança. Escolher um produto guarda o
            mapeamento para as próximas compras.
          </p>
        </div>
      </header>

      {error && <div className="alert error">{error}</div>}

      {pending.length === 0 && (
        <section className="card">
          <p className="empty">Nada para rever. A lista está toda tratada.</p>
        </section>
      )}

      <div className="stack">
        {pending.map((item) => (
          <section className="card" key={item.uuid}>
            <div className="card-head">
              <div>
                <h2>
                  {item.itemId}
                  {item.specification && <span className="muted"> · {item.specification}</span>}
                </h2>
                <p className="muted small">{item.reviewReason}</p>
              </div>
              <div className="row gap">
                <Badge kind={item.resolutionStatus ?? "needs_review"} />
                <button type="button" className="ghost" onClick={() => load(item)}>
                  {open === item.uuid ? "Fechar" : "Ver candidatos"}
                </button>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => act(item, `/api/items/${item.uuid}/retry`)}
                  disabled={busy === item.uuid}
                >
                  Tentar de novo
                </button>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => act(item, `/api/items/${item.uuid}/ignore`)}
                  disabled={busy === item.uuid}
                >
                  Ignorar
                </button>
              </div>
            </div>

            {open === item.uuid && (
              <div className="candidates">
                {busy === item.uuid && !candidates[item.uuid] && (
                  <p className="muted">A procurar no Continente…</p>
                )}
                {candidates[item.uuid]?.allowed.map((candidate) => (
                  <CandidateCard
                    key={candidate.product.id}
                    candidate={candidate}
                    onPick={() =>
                      act(item, `/api/items/${item.uuid}/pick`, {
                        productId: candidate.product.id,
                      })
                    }
                  />
                ))}
                {candidates[item.uuid]?.allowed.length === 0 && (
                  <p className="muted">Nenhum candidato passou as regras.</p>
                )}
                {candidates[item.uuid]?.blocked.length ? (
                  <details className="blocked">
                    <summary>
                      {candidates[item.uuid]?.blocked.length} candidato(s) bloqueado(s)
                    </summary>
                    <div className="stack">
                      {candidates[item.uuid]?.blocked.map((entry) => (
                        <ProductCard
                          key={entry.product.id}
                          product={entry.product}
                          reasons={[entry.reason]}
                          secondaryAction={
                            /confirm it once/i.test(entry.reason)
                              ? {
                                  label: "Confirmar como seguro",
                                  onClick: () =>
                                    act(item, `/api/items/${item.uuid}/verify`, {
                                      productId: entry.product.id,
                                    }),
                                  disabled: busy === item.uuid,
                                }
                              : undefined
                          }
                        />
                      ))}
                    </div>
                  </details>
                ) : null}
              </div>
            )}
          </section>
        ))}
      </div>

      {excluded.length > 0 && (
        <section className="card">
          <div className="card-head">
            <h2>Fora do carrinho</h2>
            <Badge kind="excluded" />
          </div>
          <p className="muted small">
            Categorias que escolheste comprar pessoalmente. Ficam na lista Bring até as marcares.
          </p>
          <ul className="plain">
            {excluded.map((item) => (
              <li key={item.uuid}>
                <span>
                  {item.itemId} {item.specification && `(${item.specification})`}
                </span>
                <span className="muted small">{item.reviewReason}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {ignored.length > 0 && (
        <section className="card">
          <div className="card-head">
            <h2>Ignorados</h2>
          </div>
          <ul className="plain">
            {ignored.map((item) => (
              <li key={item.uuid}>
                <span>{item.itemId}</span>
                <button
                  type="button"
                  className="link"
                  onClick={() => act(item, `/api/items/${item.uuid}/retry`)}
                >
                  Reativar
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
