import { euro } from "../api";
import type { Candidate, Product } from "../types";

export function ProductCard({
  product,
  score,
  reasons,
  action,
  secondaryAction,
}: {
  product: Product;
  score?: number;
  reasons?: string[];
  action?: { label: string; onClick: () => void; disabled?: boolean };
  secondaryAction?: { label: string; onClick: () => void; disabled?: boolean };
}) {
  return (
    <article className="product">
      <div className="thumb">
        {product.imageUrl ? (
          <img src={product.imageUrl} alt="" loading="lazy" />
        ) : (
          <span>{initials(product.name)}</span>
        )}
      </div>
      <div className="product-body">
        <h4>{product.name}</h4>
        <p className="muted">
          {[product.brand, product.packageText].filter(Boolean).join(" · ") || "—"}
        </p>
        <p className="muted small">{product.category ?? ""}</p>
        <div className="product-meta">
          <strong>{euro(product.price)}</strong>
          {product.unitPrice != null && (
            <span className="muted small">
              {euro(product.unitPrice)}/{product.unitPriceBasis ?? "un"}
            </span>
          )}
          {score != null && <span className="score">{(score * 100).toFixed(0)}%</span>}
        </div>
        {reasons && reasons.length > 0 && <p className="muted tiny">{reasons.join(" · ")}</p>}
        <div className="row gap">
          {action && (
            <button type="button" onClick={action.onClick} disabled={action.disabled}>
              {action.label}
            </button>
          )}
          {secondaryAction && (
            <button
              type="button"
              className="ghost"
              onClick={secondaryAction.onClick}
              disabled={secondaryAction.disabled}
            >
              {secondaryAction.label}
            </button>
          )}
          {product.url && (
            <a className="link" href={product.url} target="_blank" rel="noreferrer">
              Ver no Continente
            </a>
          )}
        </div>
      </div>
    </article>
  );
}

export function CandidateCard({ candidate, onPick }: { candidate: Candidate; onPick: () => void }) {
  return (
    <ProductCard
      product={candidate.product}
      score={candidate.score}
      reasons={candidate.reasons}
      action={{ label: "Escolher", onClick: onPick }}
    />
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase())
    .join("");
}
