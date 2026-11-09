import type { Logger } from "../logger.js";
import type { GlutenFacts, Product, ProductLabels } from "../types.js";
import { decodeEntities } from "../util/text.js";

export interface FactsCache {
  get(productId: string): GlutenFacts | null;
  put(facts: GlutenFacts): void;
}

export class MemoryFactsCache implements FactsCache {
  private readonly map = new Map<string, GlutenFacts>();
  get(productId: string): GlutenFacts | null {
    return this.map.get(productId) ?? null;
  }
  put(facts: GlutenFacts): void {
    this.map.set(facts.productId, facts);
  }
}

export interface FactsServiceOptions {
  labels: (productIds: string[]) => Promise<ProductLabels[]>;
  logger: Logger;
  cache?: FactsCache;
  fetchImpl?: typeof fetch;
  /** Re-read a cached product after this many days. */
  ttlDays?: number;
  now?: () => Date;
}

/** Reads the product page badge and the MCP label data, with a long-lived cache. */
export class ProductFactsService {
  private readonly fetchImpl: typeof fetch;
  private readonly cache: FactsCache;
  private readonly ttlMs: number;
  private readonly now: () => Date;

  constructor(private readonly options: FactsServiceOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.cache = options.cache ?? new MemoryFactsCache();
    this.ttlMs = (options.ttlDays ?? 30) * 24 * 60 * 60 * 1000;
    this.now = options.now ?? (() => new Date());
  }

  async get(product: Product): Promise<GlutenFacts | null> {
    const cached = this.cache.get(product.id);
    if (cached && this.fresh(cached)) return cached;

    let labels: ProductLabels | undefined;
    try {
      const result = await this.options.labels([product.id]);
      labels = result.find((l) => l.productId === product.id) ?? result[0];
    } catch (error) {
      this.options.logger.warn(`Could not read labels for ${product.id}`, {
        error: String(error),
      });
    }

    const badge = await this.hasBadge(product);

    const facts: GlutenFacts = {
      productId: product.id,
      name: product.name,
      category: product.category,
      productUrl: product.url,
      hasGlutenFreeBadge: badge,
      nameSaysGlutenFree: false,
      ingredients: labels?.ingredients,
      allergens: [labels?.allergens, labels?.mayContain].filter(Boolean).join(" "),
      labels,
      checkedAt: this.now().toISOString(),
    };
    this.cache.put(facts);
    return facts;
  }

  private fresh(facts: GlutenFacts): boolean {
    const checked = Date.parse(facts.checkedAt);
    return Number.isFinite(checked) && this.now().getTime() - checked < this.ttlMs;
  }

  /** Continente renders a dietary badge on the product page: `.../sem_gluten.png`. */
  private async hasBadge(product: Product): Promise<boolean> {
    const url = product.url ?? guessUrl(product);
    if (!url) return false;

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 20_000);
      const response = await this.fetchImpl(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36",
          Accept: "text/html",
        },
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!response.ok) return false;
      const html = await response.text();
      return detectGlutenFreeBadge(html);
    } catch (error) {
      this.options.logger.warn(`Could not read product page for ${product.id}`, {
        error: String(error),
      });
      return false;
    }
  }
}

export function detectGlutenFreeBadge(html: string): boolean {
  const decoded = decodeEntities(html);
  return /sem[_-]gluten/i.test(decoded) || /alt="Sem Glúten"/i.test(decoded);
}

function guessUrl(product: Product): string | undefined {
  if (product.url) return product.url;
  if (!product.slug) return undefined;
  const slug = product.slug.endsWith(product.id) ? product.slug : `${product.slug}-${product.id}`;
  return `https://www.continente.pt/produto/${slug}.html`;
}
