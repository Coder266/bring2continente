import { describe, expect, it } from "vitest";
import {
  assertOk,
  ContinenteError,
  normaliseCart,
  normaliseLabels,
  normaliseProducts,
  parseToolResult,
} from "../src/continente/adapter.js";

describe("MCP envelopes", () => {
  it("reads structuredContent.result", () => {
    const envelope = parseToolResult({
      structuredContent: { result: { status: "success", data: { ok: true } } },
    });
    expect(assertOk(envelope)).toEqual({ ok: true });
  });

  it("falls back to a JSON text block", () => {
    const envelope = parseToolResult({
      content: [{ type: "text", text: JSON.stringify({ result: { status: "success", data: 1 } }) }],
    });
    expect(assertOk(envelope)).toBe(1);
  });

  it("throws on an error envelope", () => {
    const envelope = parseToolResult({
      structuredContent: {
        result: { status: "error", error: { code: "not_authenticated", message: "login" } },
      },
    });
    expect(() => assertOk(envelope)).toThrow(ContinenteError);
  });
});

describe("Continente normalisation", () => {
  it("reads products from the documented price shapes", () => {
    const products = normaliseProducts(
      {
        products: [
          {
            productId: "00123",
            name: "Leite Meio Gordo",
            brand: "Continente",
            packageText: "1 L",
            price: { amount: { currency: "EUR", minorUnits: 89 }, per: "item" },
            unitPrice: { amount: { currency: "EUR", minorUnits: 89 }, per: "l" },
          },
        ],
      },
      "search",
    );
    expect(products[0]).toMatchObject({
      id: "00123",
      name: "Leite Meio Gordo",
      price: 0.89,
      unitPrice: 0.89,
      unitPriceBasis: "l",
    });
  });

  it("reads a single product returned at the top level", () => {
    const products = normaliseProducts(
      { productId: "42", productSlug: "leite-42", name: "Leite", url: "https://x/42.html" },
      "search",
    );
    expect(products).toHaveLength(1);
    expect(products[0]).toMatchObject({ id: "42", name: "Leite", slug: "leite-42" });
  });

  it("reads the nested label shape used by get_product_labels", () => {
    const label = normaliseLabels({
      productId: "42",
      name: "Pão",
      label: {
        ingredients: "Amido de milho, água.",
        allergenStatement: "Contém Leite. Pode conter vestígios de frutos de casca rija.",
        mayContain: "Pode conter vestígios de frutos de casca rija.",
        emphasised: ["LEITE"],
      },
    });
    expect(label.productId).toBe("42");
    expect(label.ingredients).toBe("Amido de milho, água.");
    expect(label.allergens).toContain("Contém Leite");
    expect(label.mayContain).toContain("frutos de casca rija");
  });

  it("reads cart lines, quantities and totals", () => {
    const cart = normaliseCart({
      observedAt: "2026-01-01T00:00:00Z",
      customerAuthenticated: true,
      items: [
        {
          productId: "1001",
          name: "Leite",
          quantity: { value: 2, unit: "un" },
          lineTotal: { currency: "EUR", minorUnits: 178 },
        },
      ],
      totals: {
        products: { currency: "EUR", minorUnits: 178 },
        grandTotal: { currency: "EUR", minorUnits: 178 },
      },
      checkout: { minimumOrder: { currency: "EUR", minorUnits: 2000 }, meetsMinimum: false },
    });
    expect(cart.items[0]).toMatchObject({ productId: "1001", quantity: 2 });
    expect(cart.totals.grandTotal).toBe(1.78);
    expect(cart.checkout?.minimumOrder).toBe(20);
  });
});
