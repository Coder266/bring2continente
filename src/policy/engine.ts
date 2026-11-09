import type { Product } from "../types.js";
import { normalise } from "../util/text.js";
import { decideGluten, type GlutenMode } from "./gluten.js";

export interface CategoryRulesOptions {
  excludedCategories: string[];
  nonFoodPrefixes: string[];
}

function normalisePath(value: string): string {
  return value
    .split("/")
    .map((segment) => normalise(segment))
    .join("/");
}

function matchesPrefix(category: string, prefixes: string[]): string | null {
  const path = normalisePath(category);
  for (const prefix of prefixes) {
    const p = normalisePath(prefix);
    if (path === p || path.startsWith(`${p}/`)) return prefix;
  }
  return null;
}

export class CategoryRules {
  constructor(private readonly options: CategoryRulesOptions) {}

  /** Returns the excluded prefix that matches, or null. */
  excluded(category: string | undefined | null): string | null {
    if (!category) return null;
    return matchesPrefix(category, this.options.excludedCategories);
  }
  isNonFood(category: string | undefined | null): boolean {
    if (!category) return false;
    return matchesPrefix(category, this.options.nonFoodPrefixes) !== null;
  }
}

export interface PolicyFacts {
  hasGlutenFreeBadge: boolean;
  ingredients?: string;
  allergens?: string;
}

export interface PolicyOptions extends CategoryRulesOptions {
  glutenMode: GlutenMode;
  isUserVerified?: (productId: string) => boolean;
}

export class PolicyEngine {
  private readonly categories: CategoryRules;

  constructor(private readonly options: PolicyOptions) {
    this.categories = new CategoryRules(options);
  }

  categoryExcluded(category: string | undefined | null): string | null {
    const prefix = this.categories.excluded(category);
    return prefix ? `Category is excluded on purpose (${prefix})` : null;
  }

  categoryIsNonFood(category: string | undefined | null): boolean {
    return this.categories.isNonFood(category);
  }

  evaluate(
    product: Product,
    facts: PolicyFacts | null,
  ): {
    allow: boolean;
    kind: "ok" | "excluded" | "unsafe";
    verdict: "certified" | "naturally_gf" | "risk" | "unknown";
    reason: string;
  } {
    const excluded = this.categories.excluded(product.category);
    if (excluded) {
      return {
        allow: false,
        kind: "excluded",
        verdict: "unknown",
        reason: `Category is excluded on purpose (${excluded})`,
      };
    }

    if (this.options.glutenMode === "off") {
      return { allow: true, kind: "ok", verdict: "certified", reason: "Gluten checks disabled" };
    }

    if (this.categories.isNonFood(product.category)) {
      return {
        allow: true,
        kind: "ok",
        verdict: "certified",
        reason: "Non-food item; dietary rules do not apply",
      };
    }

    if (!facts) {
      return {
        allow: false,
        kind: "unsafe",
        verdict: "unknown",
        reason: "Could not read the product label — refusing to guess",
      };
    }

    const decision = decideGluten(
      {
        name: product.name,
        hasGlutenFreeBadge: facts.hasGlutenFreeBadge,
        ingredients: facts.ingredients,
        allergens: facts.allergens,
        userVerified: this.options.isUserVerified?.(product.id) ?? false,
      },
      this.options.glutenMode,
    );

    return {
      allow: decision.allow,
      kind: decision.allow ? "ok" : "unsafe",
      verdict: decision.verdict,
      reason: decision.reason,
    };
  }
}
