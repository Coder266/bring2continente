import { describe, expect, it } from "vitest";
import { mappingKey, rank, scoreProduct, specMultiplier } from "../src/matcher/score.js";
import type { BringItem, Product } from "../src/types.js";

function item(itemId: string, specification = ""): BringItem {
  return { uuid: "u1", itemId, specification };
}

function product(id: string, name: string, extra: Partial<Product> = {}): Product {
  return { id, name, category: "Supermercado/Mercearia", ...extra };
}

describe("mapping keys", () => {
  it("normalises accents, plurals and stopwords", () => {
    expect(mappingKey(item("Pão de forma"))).toBe("pao forma");
    expect(mappingKey(item("Ovos"))).toBe("ovo");
    expect(mappingKey(item("Leite"))).toBe("leite");
  });
});

describe("scoring", () => {
  it("prefers plain milk over flavoured milk", () => {
    const ranked = rank(item("Leite"), [
      product("2", "Leite com Chocolate Continente"),
      product("1", "Leite Meio Gordo Continente 1 L"),
      product("3", "Batido de Leite Continente"),
    ]);
    expect(ranked[0]?.product.id).toBe("1");
    expect(ranked[0]?.score ?? 0).toBeGreaterThan(ranked[1]?.score ?? 0);
  });

  it("penalises a product that is a different noun", () => {
    const milk = scoreProduct(item("Leite"), product("1", "Leite Meio Gordo"));
    const shake = scoreProduct(item("Leite"), product("2", "Batido de Leite"));
    expect(milk.score).toBeGreaterThan(shake.score);
  });

  it("never returns zero for an exact name", () => {
    const scored = scoreProduct(item("Atum"), product("1", "Atum em Óleo Bom Petisco"));
    expect(scored.score).toBeGreaterThan(0.7);
  });
});

describe("quantity spec", () => {
  it("reads a unit count", () => {
    expect(specMultiplier("2")).toBe(2);
    expect(specMultiplier("2x")).toBe(2);
  });

  it("does not turn a weight into a pack count", () => {
    expect(specMultiplier("1 kg")).toBe(1);
    expect(specMultiplier("500 g")).toBe(1);
  });
});
