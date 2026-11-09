import type { ReactNode } from "react";

const LABELS: Record<string, { text: string; className: string }> = {
  certified: { text: "Sem glúten", className: "badge green" },
  naturally_gf: { text: "Confirmado por ti", className: "badge lime" },
  risk: { text: "Contém glúten", className: "badge red" },
  unknown: { text: "Sem dados", className: "badge amber" },
  excluded: { text: "Fora do carrinho", className: "badge gray" },
  heuristic: { text: "Automático", className: "badge blue" },
  llm: { text: "Modelo", className: "badge purple" },
  user: { text: "Escolhido por ti", className: "badge green" },
  seed: { text: "Semente", className: "badge gray" },
  resolved: { text: "Resolvido", className: "badge green" },
  needs_review: { text: "Rever", className: "badge amber" },
  unsafe: { text: "Bloqueado", className: "badge red" },
  no_match: { text: "Sem match", className: "badge gray" },
  ignored: { text: "Ignorado", className: "badge gray" },
  error: { text: "Erro", className: "badge red" },
};

export function Badge({ kind, children }: { kind: string; children?: ReactNode }) {
  const entry = LABELS[kind] ?? { text: kind, className: "badge gray" };
  return <span className={entry.className}>{children ?? entry.text}</span>;
}
