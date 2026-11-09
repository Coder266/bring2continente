import { describe, expect, it } from "vitest";
import { analyseGlutenText, decideGluten, nameSaysGlutenFree } from "../src/policy/gluten.js";

describe("gluten text analysis", () => {
  it("flags wheat in an ingredient list", () => {
    const result = analyseGlutenText("Farinha de trigo, açúcar, óleo vegetal.");
    expect(result.mentionsGluten).toBe(true);
    expect(result.matched).toContain("trigo");
  });

  it("does not confuse buckwheat with wheat", () => {
    const result = analyseGlutenText("Farinha de trigo sarraceno, arroz.");
    expect(result.mentionsGluten).toBe(false);
  });

  it("ignores a gluten-free claim", () => {
    const result = analyseGlutenText("Produto sem glúten. Ingredientes: arroz, água.");
    expect(result.mentionsGluten).toBe(false);
    expect(nameSaysGlutenFree("Bolachas sem Glúten Continente")).toBe(true);
  });

  it("does not treat a milk trace warning as a gluten warning", () => {
    const result = analyseGlutenText("Ingredientes: arroz. Pode conter vestígios de leite.");
    expect(result.mayContain).toBe(false);
  });

  it("detects a may-contain-gluten warning", () => {
    const result = analyseGlutenText("Pode conter vestígios de glúten.");
    expect(result.mayContain).toBe(true);
  });

  it("detects oats and barley as gluten sources", () => {
    expect(analyseGlutenText("Aveia, cevada, malte.").mentionsGluten).toBe(true);
  });

  it("ignores deglutenised starch and nut trace warnings", () => {
    const result = analyseGlutenText(
      "Amido de milho deglutenizado, água.",
      "Pode conter vestígios de frutos de casca rija.",
    );
    expect(result.mentionsGluten).toBe(false);
    expect(result.mayContain).toBe(false);
  });
});

describe("gluten decision", () => {
  const base = {
    name: "Produto",
    hasGlutenFreeBadge: false,
    ingredients: "Arroz, água, sal.",
    allergens: "",
    userVerified: false,
  };

  it("accepts a product with Continente's gluten-free badge", () => {
    const decision = decideGluten({ ...base, hasGlutenFreeBadge: true }, "strict");
    expect(decision.allow).toBe(true);
    expect(decision.verdict).toBe("certified");
  });

  it("rejects a product whose ingredients mention gluten", () => {
    const decision = decideGluten(
      { ...base, ingredients: "Farinha de trigo, água.", hasGlutenFreeBadge: true },
      "strict",
    );
    expect(decision.allow).toBe(false);
    expect(decision.verdict).toBe("risk");
  });

  it("rejects may-contain warnings in strict mode", () => {
    const decision = decideGluten(
      { ...base, allergens: "Pode conter vestígios de glúten." },
      "strict",
    );
    expect(decision.allow).toBe(false);
  });

  it("fails closed when there is no label", () => {
    const decision = decideGluten({ ...base, ingredients: "", allergens: "" }, "strict");
    expect(decision.allow).toBe(false);
    expect(decision.verdict).toBe("unknown");
  });

  it("accepts a naturally gluten-free product after one confirmation", () => {
    const decision = decideGluten({ ...base, userVerified: true }, "strict");
    expect(decision.allow).toBe(true);
    expect(decision.verdict).toBe("naturally_gf");
  });

  it("rejects a gluten-free claim when the ingredients contain barley malt", () => {
    const decision = decideGluten(
      {
        name: "Pão de Forma Integral com Côdea sem Glúten Continente",
        hasGlutenFreeBadge: true,
        ingredients:
          "Amido de milho, água, farinha de arroz, extrato de MALTE DE CEVADA, sementes de linho.",
        allergens: "Contém Cevada. Pode conter vestígios de sementes de sésamo.",
        userVerified: false,
      },
      "strict",
    );
    expect(decision.allow).toBe(false);
    expect(decision.verdict).toBe("risk");
  });
});
