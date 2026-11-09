import type { BringItem, Product } from "../types.js";
import { normalise, parseSpecQuantity, singularTokens, tokens } from "../util/text.js";

const STOPWORDS = new Set([
  "de",
  "da",
  "do",
  "das",
  "dos",
  "e",
  "com",
  "para",
  "em",
  "no",
  "na",
  "nos",
  "nas",
  "um",
  "uma",
  "uns",
  "umas",
  "pack",
  "embalagem",
  "unidade",
  "unidades",
]);

/** Words that change the product into something the list did not ask for. */
const CATEGORY_CHANGERS = [
  "batido",
  "iogurte",
  "queijo",
  "manteiga",
  "sobremesa",
  "bolacha",
  "bolo",
  "gelado",
  "creme",
  "molho",
  "sopa",
  "pizza",
  "lasanha",
  "hamburguer",
  "salsicha",
  "pate",
  "doce",
  "salgado",
  "aromatizado",
  "temperado",
  "panado",
  "recheado",
];

const VARIANT_WORDS = [
  "chocolate",
  "morango",
  "baunilha",
  "limao",
  "laranja",
  "light",
  "zero",
  "integral",
  "bio",
  "fumado",
  "defumado",
  "picante",
  "arroz",
  "aveia",
  "amendoas",
  "mel",
];

function contentTokens(value: string): string[] {
  return singularTokens(value).filter((t) => !STOPWORDS.has(t));
}

/** Stable key for a Bring item: its name, independent of quantity in the spec. */
export function mappingKey(item: Pick<BringItem, "itemId">): string {
  return contentTokens(item.itemId).join(" ");
}

export interface ScoredCandidate {
  product: Product;
  score: number;
  reasons: string[];
}

export function scoreProduct(item: BringItem, product: Product): ScoredCandidate {
  const itemTokens = contentTokens(item.itemId);
  const productTokens = contentTokens(product.name);
  const reasons: string[] = [];
  if (itemTokens.length === 0) return { product, score: 0, reasons: ["empty item name"] };

  const matched = itemTokens.filter((t) => productTokens.includes(t));
  let score = (matched.length / itemTokens.length) * 0.75;

  if (matched.length === itemTokens.length) {
    score += 0.08;
    reasons.push("all words matched");
  } else if (matched.length === 0) {
    return { product, score: 0, reasons: ["no words matched"] };
  }

  const itemText = normalise(item.itemId);
  const productText = normalise(product.name);
  if (productText.startsWith(itemText)) {
    score += 0.1;
    reasons.push("name starts with the item");
  }

  // The head noun should come early: "Batido de Leite" is not "Leite".
  const head = itemTokens[0];
  if (head) {
    const position = productTokens.indexOf(head);
    if (position > 0) {
      score -= Math.min(0.2, position * 0.06);
      reasons.push(`head word at position ${position}`);
    }
  }

  const extra = productTokens.filter((t) => !itemTokens.includes(t));
  const changers = extra.filter((t) => CATEGORY_CHANGERS.includes(t));
  if (changers.length > 0) {
    score -= Math.min(0.3, changers.length * 0.15);
    reasons.push(`different product type: ${changers.join(", ")}`);
  }

  const variants = extra.filter((t) => VARIANT_WORDS.includes(t));
  if (variants.length > 0) {
    score -= Math.min(0.28, variants.length * 0.14);
    reasons.push(`unrequested variant: ${variants.join(", ")}`);
  }

  const brandTokens = product.brand ? tokens(product.brand) : [];
  if (brandTokens.some((t) => itemTokens.includes(t))) {
    score += 0.05;
    reasons.push("brand mentioned in the list item");
  }

  const spec = parseSpecQuantity(item.specification);
  if (spec?.unit && product.packageText) {
    const pack = normalise(product.packageText);
    const unit = spec.unit === "litro" || spec.unit === "litros" ? "l" : spec.unit;
    if (unit && pack.includes(unit)) {
      score += 0.05;
      reasons.push("pack size unit matches the list");
    }
  }

  if (product.source === "history") {
    score += 0.05;
    reasons.push("bought before");
  }
  if (product.favorite) {
    score += 0.03;
    reasons.push("favourite");
  }

  return { product, score: Math.max(0, Math.min(1, score)), reasons };
}

export function rank(item: BringItem, products: Product[]): ScoredCandidate[] {
  const seen = new Set<string>();
  return products
    .filter((p) => {
      if (seen.has(p.id)) return false;
      seen.add(p.id);
      return true;
    })
    .map((product) => scoreProduct(item, product))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score);
}

export function specMultiplier(spec: string): number {
  const parsed = parseSpecQuantity(spec);
  if (!parsed) return 1;
  if (parsed.unit && !["x", "un", "unid", undefined].includes(parsed.unit)) return 1;
  return Math.max(1, Math.min(12, Math.round(parsed.quantity)));
}
