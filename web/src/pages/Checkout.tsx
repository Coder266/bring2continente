import { useEffect, useState } from "react";
import { api, when } from "../api";
import type { PendingCheckout } from "../types";

export function Checkout({ refresh }: { refresh: () => void }) {
  const [pending, setPending] = useState<PendingCheckout[]>([]);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    api<{ pending: PendingCheckout[] }>("/api/checkout")
      .then((data) => setPending(data.pending))
      .catch((err) => setError(String(err)));
  };

  useEffect(load, []);

  const act = async (id: number, action: "confirm" | "dismiss") => {
    setBusy(id);
    setError(null);
    try {
      await api(`/api/checkout/${id}/${action}`, { method: "POST" });
      load();
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
          <h1>Checkout</h1>
          <p className="muted">
            Quando um pedido novo aparece e o carrinho esvazia, os itens que iam no carrinho podem
            ser marcados na lista Bring. O que ficou de fora (carne, peixe, fruta, legumes) continua
            por comprar.
          </p>
        </div>
      </header>

      {error && <div className="alert error">{error}</div>}

      {pending.length === 0 && (
        <section className="card">
          <p className="empty">Sem pedidos pendentes.</p>
        </section>
      )}

      <div className="stack">
        {pending.map((checkout) => (
          <section className="card" key={checkout.id}>
            <div className="card-head">
              <div>
                <h2>Encomenda {checkout.orderNumber ?? checkout.orderId}</h2>
                <p className="muted small">
                  {checkout.lines.length} linha(s) · {when(checkout.createdAt)}
                </p>
              </div>
              <div className="row gap">
                <button
                  type="button"
                  onClick={() => act(checkout.id, "confirm")}
                  disabled={busy === checkout.id}
                >
                  Marcar {checkout.bringUuids.length} item(s)
                </button>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => act(checkout.id, "dismiss")}
                  disabled={busy === checkout.id}
                >
                  Ignorar
                </button>
              </div>
            </div>
            <table className="table">
              <thead>
                <tr>
                  <th>Produto na encomenda</th>
                  <th className="num">Qtd</th>
                </tr>
              </thead>
              <tbody>
                {checkout.lines.map((line, index) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: order lines have no stable id here
                  <tr key={`${line.productId ?? line.name}-${index}`}>
                    <td>{line.name}</td>
                    <td className="num">{line.quantity ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
      </div>
    </div>
  );
}
