import type { ContinenteAdapter } from "../continente/adapter.js";
import type { Logger } from "../logger.js";
import type { PolicyEngine } from "../policy/engine.js";
import type { ProductFactsService } from "../policy/facts.js";
import type { Store } from "../store/index.js";
import type { BringItem, GlutenVerdict, Mapping, Product } from "../types.js";
import type { ProductPicker } from "./picker.js";
import { mappingKey, rank, type ScoredCandidate } from "./score.js";

export interface ResolveOptions {
  autoThreshold: number;
  autoMargin: number;
  maxCandidates: number;
  /** How many candidates to spend a product-page read on. */
  factsLimit?: number;
  glutenMode: "strict" | "standard" | "off";
}

interface AllowedCandidate {
  candidate: ScoredCandidate;
  verdict: GlutenVerdict;
  reason: string;
}

export type Resolution =
  | {
      status: "resolved";
      product: Product;
      confidence: number;
      source: Mapping["source"];
      verdict: Mapping["verdict"];
      reason: string;
      multiplier: number;
      mappingId: number;
    }
  | {
      status: "needs_review";
      reason: string;
      candidates: ScoredCandidate[];
      blocked: Array<{ product: Product; reason: string }>;
    }
  | {
      status: "excluded" | "unsafe";
      reason: string;
      candidates: ScoredCandidate[];
      blocked: Array<{ product: Product; reason: string }>;
    }
  | { status: "no_match"; reason: string };

export interface ResolverDeps {
  adapter: ContinenteAdapter;
  facts: ProductFactsService;
  policy: PolicyEngine;
  store: Store;
  picker: ProductPicker | null;
  logger: Logger;
  options: ResolveOptions;
}

export class Resolver {
  constructor(private readonly deps: ResolverDeps) {}

  async resolve(item: BringItem): Promise<Resolution> {
    const key = mappingKey(item);
    const existing = this.deps.store.findMapping(key);
    if (existing) {
      const reused = await this.reuseMapping(item, existing);
      if (reused) return reused;
    }

    const match = await this.findCandidates(item);
    const { blocked, preRanked, allowed } = match;

    if (preRanked.length === 0) {
      return {
        status: "no_match",
        reason: `No Continente product found for "${item.itemId}"`,
      };
    }

    if (allowed.length === 0) {
      const allExcluded =
        blocked.length > 0 && blocked.every((b) => /excluded on purpose/i.test(b.reason));
      return {
        status: allExcluded ? "excluded" : "unsafe",
        reason: allExcluded
          ? (blocked[0]?.reason ?? "Every matching product is in an excluded category")
          : (blocked[0]?.reason ?? "No candidate passed the dietary rules"),
        candidates: preRanked.slice(0, 8),
        blocked,
      };
    }

    const ranked = allowed.sort((a, b) => b.candidate.score - a.candidate.score);
    const top = ranked[0];
    const second = ranked[1];
    if (!top) {
      return { status: "needs_review", reason: "No candidate left", candidates: [], blocked };
    }

    const margin = second ? top.candidate.score - second.candidate.score : 1;
    if (
      top.candidate.score >= this.deps.options.autoThreshold &&
      margin >= this.deps.options.autoMargin
    ) {
      return this.persist(
        item,
        top.candidate.product,
        top.candidate.score,
        "heuristic",
        top.reason,
        top.verdict,
      );
    }

    if (this.deps.picker) {
      const pick = await this.deps.picker
        .pick(
          item,
          ranked.slice(0, 5).map((r) => r.candidate),
        )
        .catch((error) => {
          this.deps.logger.warn("Model picker failed", { error: String(error) });
          return null;
        });
      if (pick?.productId && pick.confidence >= 0.5) {
        const chosen = ranked.find((r) => r.candidate.product.id === pick.productId);
        if (chosen) {
          return this.persist(
            item,
            chosen.candidate.product,
            pick.confidence,
            "llm",
            `${pick.reason} (model)`,
            chosen.verdict,
          );
        }
      }
    }

    return {
      status: "needs_review",
      reason:
        second && top.candidate.score - second.candidate.score < this.deps.options.autoMargin
          ? "Several plausible products; pick one"
          : "No confident match",
      candidates: ranked.map((r) => r.candidate),
      blocked,
    };
  }

  async findCandidates(item: BringItem): Promise<{
    allowed: AllowedCandidate[];
    blocked: Array<{ product: Product; reason: string }>;
    preRanked: ScoredCandidate[];
  }> {
    const products = await this.search(item);
    const preRanked = rank(item, products);
    const blocked: Array<{ product: Product; reason: string }> = [];
    const allowed: AllowedCandidate[] = [];
    const factsLimit = this.deps.options.factsLimit ?? 6;

    for (const candidate of preRanked.slice(0, factsLimit)) {
      const excluded = this.deps.policy.categoryExcluded(candidate.product.category);
      if (excluded) {
        blocked.push({ product: candidate.product, reason: excluded });
        continue;
      }
      if (this.deps.policy.categoryIsNonFood(candidate.product.category)) {
        allowed.push({ candidate, verdict: "certified", reason: "Non-food item" });
        continue;
      }
      const facts = await this.deps.facts.get(candidate.product);
      const decision = this.deps.policy.evaluate(candidate.product, facts);
      if (decision.allow) {
        allowed.push({ candidate, verdict: decision.verdict, reason: decision.reason });
      } else {
        blocked.push({ product: candidate.product, reason: decision.reason });
      }
    }

    return { allowed, blocked, preRanked };
  }

  /** Candidate list for the review UI; no matching decision is persisted. */
  async candidates(item: BringItem): Promise<{
    allowed: ScoredCandidate[];
    blocked: Array<{ product: Product; reason: string }>;
  }> {
    const match = await this.findCandidates(item);
    return { allowed: match.allowed.map((a) => a.candidate), blocked: match.blocked };
  }

  private async reuseMapping(item: BringItem, mapping: Mapping): Promise<Resolution | null> {
    const ageDays = (Date.now() - Date.parse(mapping.updatedAt || mapping.createdAt)) / 86_400_000;
    const product = productFromMapping(mapping);

    const excluded = this.deps.policy.categoryExcluded(mapping.category);
    if (excluded) return null;

    if (ageDays <= 30) {
      return {
        status: "resolved",
        product,
        confidence: mapping.confidence ?? 1,
        source: mapping.source,
        verdict: mapping.verdict,
        reason: `Known mapping (${mapping.source})`,
        multiplier: mapping.multiplier,
        mappingId: mapping.id,
      };
    }

    // Re-verify stale mappings instead of trusting a label read from a month ago.
    const freshProduct = (await this.deps.adapter.getProduct(mapping.productId)) ?? product;
    const facts = await this.deps.facts.get(freshProduct);
    const decision = this.deps.policy.evaluate(freshProduct, facts);
    if (!decision.allow) {
      this.deps.logger.warn(`Mapping for ${item.itemId} no longer passes policy`, {
        productId: mapping.productId,
        reason: decision.reason,
      });
      return null;
    }
    this.deps.store.upsertMapping({
      normKey: mapping.normKey,
      bringName: item.itemId,
      bringSpec: item.specification || null,
      product: freshProduct,
      source: mapping.source,
      confidence: mapping.confidence,
      multiplier: mapping.multiplier,
      verdict: decision.verdict,
      verdictReason: decision.reason,
    });
    return {
      status: "resolved",
      product: freshProduct,
      confidence: mapping.confidence ?? 1,
      source: mapping.source,
      verdict: decision.verdict,
      reason: `Known mapping, re-verified: ${decision.reason}`,
      multiplier: mapping.multiplier,
      mappingId: mapping.id,
    };
  }

  private async search(item: BringItem): Promise<Product[]> {
    const queries = [item.itemId];
    if (this.deps.options.glutenMode !== "off") {
      queries.push(`${item.itemId} sem gluten`);
    }
    const results: Product[] = [];
    for (const query of queries) {
      try {
        results.push(...(await this.deps.adapter.search(query, this.deps.options.maxCandidates)));
      } catch (error) {
        this.deps.logger.warn(`Search failed for ${JSON.stringify(query)}`, {
          error: String(error),
        });
      }
    }
    return results;
  }

  private persist(
    item: BringItem,
    product: Product,
    confidence: number,
    source: Mapping["source"],
    reason: string,
    verdict: GlutenVerdict,
  ): Resolution {
    const mapping = this.deps.store.upsertMapping({
      normKey: mappingKey(item),
      bringName: item.itemId,
      bringSpec: item.specification || null,
      product,
      source,
      confidence,
      multiplier: 1,
      verdict,
      verdictReason: reason,
    });
    this.deps.store.addEvent("info", "mapping", `Matched "${item.itemId}" to ${product.name}`, {
      productId: product.id,
      confidence,
      source,
      reason,
    });
    return {
      status: "resolved",
      product,
      confidence,
      source,
      verdict: mapping.verdict,
      reason,
      multiplier: mapping.multiplier,
      mappingId: mapping.id,
    };
  }
}

export function productFromMapping(mapping: Mapping): Product {
  return {
    id: mapping.productId,
    name: mapping.productName,
    brand: mapping.brand ?? undefined,
    category: mapping.category ?? undefined,
    packageText: mapping.packageText ?? undefined,
    url: mapping.productUrl ?? undefined,
    imageUrl: mapping.imageUrl ?? undefined,
  };
}
