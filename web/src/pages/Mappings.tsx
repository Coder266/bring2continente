import { useEffect, useState } from "react";
import { api, when } from "../api";
import { Badge } from "../components/Badge";
import { ProductCard } from "../components/ProductCard";
import type { Candidate, Mapping, Product } from "../types";

interface FixCandidates {
  allowed: Candidate[];
  blocked: Array<{ product: Product; reason: string }>;
}

export function Mappings({ version }: { version: number }) {
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fixing, setFixing] = useState<number | null>(null);
  const [candidates, setCandidates] = useState<Record<number, FixCandidates>>({});

  // biome-ignore lint/correctness/useExhaustiveDependencies: version is a refresh trigger
  useEffect(() => {
    api<{ mappings: Mapping[] }>("/api/mappings")
      .then((data) => setMappings(data.mappings))
      .catch((err) => setError(String(err)));
  }, [version]);

  const filtered = mappings.filter((mapping) => {
    const haystack =
      `${mapping.bringName} ${mapping.productName} ${mapping.brand ?? ""}`.toLowerCase();
    return haystack.includes(filter.toLowerCase());
  });

  const act = async (id: number, body: unknown) => {
    setBusy(id);
    setError(null);
    try {
      const updated = await api<Mapping>(`/api/mappings/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      setMappings((prev) => prev.map((m) => (m.id === id ? updated : m)));
      setFixing(null);
      setCandidates((prev) => {
        const copy = { ...prev };
        delete copy[id];
        return copy;
      });
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(null);
    }
  };

  const openFix = async (id: number) => {
    if (fixing === id) {
      setFixing(null);
      return;
    }
    setFixing(id);
    if (candidates[id]) return;
    setBusy(id);
    setError(null);
    try {
      const data = await api<FixCandidates>(`/api/mappings/${id}/candidates`);
      setCandidates((prev) => ({ ...prev, [id]: data }));
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(null);
    }
  };

  const remove = async (id: number) => {
    if (!window.confirm("Apagar este mapeamento? O item volta a ser resolvido do zero.")) return;
    setBusy(id);
    try {
      await api(`/api/mappings/${id}`, { method: "DELETE" });
      setMappings((prev) => prev.filter((m) => m.id !== id));
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
          <h1>Mapeamentos</h1>
          <p className="muted">
            A memória do motor: cada linha liga um item da lista ao produto que escolheste (ou que
            foi escolhido por ti/automático).
          </p>
        </div>
        <input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Filtrar…"
          aria-label="Filtrar mapeamentos"
        />
      </header>

      {error && <div className="alert error">{error}</div>}

      <section className="card">
        {filtered.length === 0 ? (
          <p className="empty">Ainda não há mapeamentos.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Lista</th>
                <th>Produto</th>
                <th>Regra</th>
                <th>Origem</th>
                <th className="num">Qtd</th>
                <th>Atualizado</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.map((mapping) => (
                <tr key={mapping.id}>
                  <td>
                    <strong>{mapping.bringName}</strong>
                    <div className="muted tiny">
                      {[mapping.bringSpec, mapping.packageText].filter(Boolean).join(" · ")}
                    </div>
                  </td>
                  <td>
                    {mapping.productUrl ? (
                      <a href={mapping.productUrl} target="_blank" rel="noreferrer">
                        {mapping.productName}
                      </a>
                    ) : (
                      mapping.productName
                    )}
                    <div className="muted tiny">{mapping.category ?? ""}</div>
                  </td>
                  <td>
                    <Badge kind={mapping.verdict} />
                    <div className="muted tiny">{mapping.verdictReason ?? ""}</div>
                  </td>
                  <td>
                    <Badge kind={mapping.source} />
                    {mapping.confidence != null && (
                      <div className="muted tiny">{(mapping.confidence * 100).toFixed(0)}%</div>
                    )}
                  </td>
                  <td className="num">
                    <input
                      type="number"
                      min={1}
                      max={12}
                      defaultValue={mapping.multiplier}
                      className="tiny-input"
                      onBlur={(event) => {
                        const value = Number(event.target.value);
                        if (value !== mapping.multiplier)
                          void act(mapping.id, { multiplier: value });
                      }}
                    />
                  </td>
                  <td className="muted small">{when(mapping.updatedAt)}</td>
                  <td>
                    <div className="row gap">
                      {mapping.verdict === "unknown" && (
                        <button
                          type="button"
                          className="ghost small"
                          onClick={() =>
                            act(mapping.id, { productId: mapping.productId, verify: true })
                          }
                          disabled={busy === mapping.id}
                        >
                          Confirmar
                        </button>
                      )}
                      <button
                        type="button"
                        className="ghost small"
                        onClick={() => openFix(mapping.id)}
                        disabled={busy === mapping.id}
                      >
                        {fixing === mapping.id ? "Fechar" : "Corrigir"}
                      </button>
                      <button
                        type="button"
                        className="link danger"
                        onClick={() => remove(mapping.id)}
                        disabled={busy === mapping.id}
                      >
                        Apagar
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {fixing != null && candidates[fixing] && (
          <div className="correction">
            <div className="card-head">
              <div>
                <h2>Corrigir “{mappings.find((m) => m.id === fixing)?.bringName}”</h2>
                <p className="muted small">
                  Escolhe outro produto. Se o item ainda estiver na lista, a linha do carrinho é
                  trocada e o novo mapeamento fica guardado.
                </p>
              </div>
              <button type="button" className="ghost" onClick={() => setFixing(null)}>
                Fechar
              </button>
            </div>
            <div className="candidates">
              {candidates[fixing]?.allowed.map((candidate) => (
                <ProductCard
                  key={candidate.product.id}
                  product={candidate.product}
                  score={candidate.score}
                  reasons={candidate.reasons}
                  action={{
                    label: "Usar este",
                    onClick: () => act(fixing, { productId: candidate.product.id }),
                  }}
                />
              ))}
              {candidates[fixing]?.allowed.length === 0 && (
                <p className="muted">Nenhum candidato passou as regras.</p>
              )}
              {candidates[fixing]?.blocked.length ? (
                <details className="blocked" open={candidates[fixing]?.allowed.length === 0}>
                  <summary>{candidates[fixing]?.blocked.length} candidato(s) bloqueado(s)</summary>
                  <div className="stack">
                    {candidates[fixing]?.blocked.map((entry) => (
                      <ProductCard
                        key={entry.product.id}
                        product={entry.product}
                        reasons={[entry.reason]}
                      />
                    ))}
                  </div>
                </details>
              ) : null}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
