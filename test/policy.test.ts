import { describe, expect, it } from "vitest";
import { PolicyEngine } from "../src/policy/engine.js";
import type { Product } from "../src/types.js";

const policy = new PolicyEngine({
  glutenMode: "strict",
  excludedCategories: [
    "Supermercado/Talho",
    "Supermercado/Peixaria",
    "Supermercado/Frutas e Legumes",
  ],
  nonFoodPrefixes: ["Supermercado/Limpeza"],
  isUserVerified: () => false,
});

function product(category: string, name = "Produto"): Product {
  return { id: "1", name, category };
}

const safeFacts = {
  hasGlutenFreeBadge: true,
  ingredients: "Arroz, água.",
  allergens: "",
};

describe("category rules", () => {
  it("blocks the butcher and the fishmonger", () => {
    expect(policy.categoryExcluded("Supermercado/Talho/Novilho")).toMatch(/Talho/);
    expect(policy.categoryExcluded("Supermercado/Peixaria/Peixe Fresco/Salmão")).toMatch(
      /Peixaria/,
    );
  });

  it("blocks fresh produce but not frozen produce", () => {
    expect(policy.categoryExcluded("Supermercado/Frutas e Legumes/Frutas/Banana")).toMatch(
      /Frutas e Legumes/,
    );
    expect(policy.categoryExcluded("Supermercado/Congelados/Frutas e Legumes/Legumes")).toBeNull();
  });

  it("keeps charcuterie and cheese available", () => {
    expect(policy.categoryExcluded("Supermercado/Charcutaria e Queijos/Queijo")).toBeNull();
  });

  it("returns an excluded decision without needing product facts", () => {
    const decision = policy.evaluate(product("Supermercado/Talho/Frango"), null);
    expect(decision.allow).toBe(false);
    expect(decision.kind).toBe("excluded");
  });
});

describe("dietary policy", () => {
  it("allows non-food items to bypass gluten checks", () => {
    const decision = policy.evaluate(product("Supermercado/Limpeza/Detergentes"), null);
    expect(decision.allow).toBe(true);
    expect(decision.reason).toMatch(/Non-food/);
  });

  it("fails closed for food without label data", () => {
    const decision = policy.evaluate(product("Supermercado/Mercearia/Arroz"), null);
    expect(decision.allow).toBe(false);
    expect(decision.verdict).toBe("unknown");
  });

  it("accepts a certified product", () => {
    const decision = policy.evaluate(product("Supermercado/Mercearia/Arroz"), safeFacts);
    expect(decision.allow).toBe(true);
    expect(decision.verdict).toBe("certified");
  });

  it("blocks gluten ingredients even with a badge", () => {
    const decision = policy.evaluate(product("Supermercado/Padaria/Pão"), {
      hasGlutenFreeBadge: true,
      ingredients: "Farinha de trigo, água.",
      allergens: "",
    });
    expect(decision.allow).toBe(false);
    expect(decision.kind).toBe("unsafe");
  });
});
