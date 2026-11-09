import { useEffect, useState } from "react";
import { api, when } from "../api";
import type { Rules as RulesData } from "../types";

export function Rules() {
  const [rules, setRules] = useState<RulesData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<RulesData>("/api/rules")
      .then(setRules)
      .catch((err) => setError(String(err)));
  }, []);

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Regras</h1>
          <p className="muted">
            O que entra no carrinho é decidido por estas regras, antes de qualquer escolha de
            produto. São configuradas por ambiente (variáveis <code>GLUTEN_MODE</code>,{" "}
            <code>EXCLUDED_CATEGORIES</code>, …).
          </p>
        </div>
      </header>

      {error && <div className="alert error">{error}</div>}
      {!rules ? (
        <p className="muted">A carregar…</p>
      ) : (
        <div className="grid two">
          <section className="card">
            <h2>Segurança alimentar</h2>
            <p>
              Modo: <strong>{rules.glutenMode}</strong>
            </p>
            <ul className="plain">
              <li>
                <span>Sem glúten no nome ou selo Continente</span>
                <span className="badge green">entra</span>
              </li>
              <li>
                <span>Sem glúten nos ingredientes, sem selo</span>
                <span className="badge lime">confirmas uma vez</span>
              </li>
              <li>
                <span>Contém glúten ou “pode conter vestígios”</span>
                <span className="badge red">nunca entra</span>
              </li>
              <li>
                <span>Sem dados de rótulo</span>
                <span className="badge amber">fica para rever</span>
              </li>
            </ul>
            <p className="muted small">
              Em modo <strong>strict</strong> um aviso de vestígios é sempre bloqueio. O motor nunca
              escolhe um produto com glúten como alternativa.
            </p>
          </section>

          <section className="card">
            <h2>Categorias fora do carrinho</h2>
            <div className="chips">
              {rules.excludedCategories.map((category) => (
                <span className="chip" key={category}>
                  {category}
                </span>
              ))}
            </div>
            <p className="muted small">
              Comparação por prefixo: <code>Supermercado/Frutas e Legumes</code> exclui frescos mas
              deixa passar congelados. Charcutaria e queijos ficam disponíveis.
            </p>
            <h3>Isentos de regras alimentares</h3>
            <div className="chips">
              {rules.nonFoodPrefixes.map((prefix) => (
                <span className="chip gray" key={prefix}>
                  {prefix}
                </span>
              ))}
            </div>
          </section>

          <section className="card">
            <h2>Confiança do matcher</h2>
            <p>
              Entra automaticamente acima de{" "}
              <strong>{Math.round(rules.autoThreshold * 100)}%</strong> com uma margem de{" "}
              <strong>{Math.round(rules.autoMargin * 100)}%</strong> sobre o segundo. Abaixo disso,
              o modelo decide; se também não tiver confiança, fica para rever.
            </p>
            <p className="muted small">
              Modelo: <strong>{rules.llm}</strong>
            </p>
          </section>

          <section className="card">
            <h2>Produtos confirmados por ti</h2>
            {rules.verifiedProducts.length === 0 ? (
              <p className="empty">
                Nenhum. Quando um produto não tem selo mas o rótulo não tem glúten, podes
                confirmá-lo na página Rever.
              </p>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Produto</th>
                    <th>Confirmado</th>
                  </tr>
                </thead>
                <tbody>
                  {rules.verifiedProducts.map((product) => (
                    <tr key={product.productId}>
                      <td>{product.name}</td>
                      <td className="muted small">{when(product.verifiedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
