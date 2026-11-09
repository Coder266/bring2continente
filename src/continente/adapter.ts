import type { Cart, CartLine, Order, OrderLine, Product, ProductLabels } from "../types.js";

export interface ContinenteAdapter {
  readonly name: string;
  search(query: string, limit: number): Promise<Product[]>;
  getProduct(productId: string): Promise<Product | null>;
  getLabels(productIds: string[]): Promise<ProductLabels[]>;
  getCart(): Promise<Cart>;
  add(productId: string, quantity: number): Promise<Cart>;
  setQuantity(productId: string, quantity: number): Promise<Cart>;
  remove(productId: string): Promise<Cart>;
  listOrders(limit: number): Promise<Order[]>;
  frequentlyBought(limit: number): Promise<Product[]>;
  sessionStatus(): Promise<{ authenticated: boolean; detail?: string }>;
  close(): Promise<void>;
}

export class ContinenteError extends Error {
  constructor(
    message: string,
    readonly code: string = "continente_error",
    readonly retryable = false,
  ) {
    super(message);
    this.name = "ContinenteError";
  }
}

export interface ToolEnvelope {
  status?: string;
  data?: unknown;
  error?: { code?: string; message?: string; retryable?: boolean };
}

/** Extracts `structuredContent.result` (or a JSON text block) from an MCP tool response. */
export function parseToolResult(response: unknown): ToolEnvelope {
  const res = response as {
    structuredContent?: { result?: ToolEnvelope };
    content?: Array<{ type?: string; text?: string }>;
  };
  if (res.structuredContent?.result) return res.structuredContent.result;

  const text = res.content?.find((c) => c.type === "text")?.text;
  if (text) {
    try {
      const parsed = JSON.parse(text) as { result?: ToolEnvelope } | ToolEnvelope;
      return "result" in parsed && parsed.result ? parsed.result : (parsed as ToolEnvelope);
    } catch {
      // fall through
    }
  }
  throw new ContinenteError("Unrecognised MCP tool response", "bad_response");
}

export function assertOk(envelope: ToolEnvelope): unknown {
  if (envelope.status === "error" || envelope.error) {
    throw new ContinenteError(
      envelope.error?.message ?? "Continente tool returned an error",
      envelope.error?.code ?? "tool_error",
      Boolean(envelope.error?.retryable),
    );
  }
  return envelope.data;
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object" ? (value as Record<string, any>) : {};
}

/** Money is either a number or `{ currency, minorUnits }`; return EUR as a float. */
export function money(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const rec = asRecord(value);
  if (typeof rec.minorUnits === "number") return rec.minorUnits / 100;
  if (typeof rec.amount === "number") return rec.amount;
  if (typeof rec.value === "number") return rec.value;
  return undefined;
}

function priceTag(value: unknown): { amount?: number; per?: string } {
  const rec = asRecord(value);
  if (rec.amount !== undefined) {
    return { amount: money(rec.amount), per: rec.per ?? rec.basis };
  }
  return { amount: money(value), per: rec.per ?? rec.basis };
}

function pickArray(data: unknown, keys: string[]): any[] {
  const rec = asRecord(data);
  for (const key of keys) {
    if (Array.isArray(rec[key])) return rec[key];
  }
  return Array.isArray(data) ? data : [];
}

export function normaliseProduct(raw: unknown, source: Product["source"]): Product {
  const p = asRecord(raw);
  const price = priceTag(p.price ?? p.prices?.price);
  const unit = priceTag(p.unitPrice ?? p.secondaryPrice);
  const id = String(p.productId ?? p.id ?? "");
  return {
    id,
    name: String(p.name ?? p.productName ?? "").trim(),
    brand: p.brand ?? undefined,
    category: p.category ?? undefined,
    url: p.url ?? p.productUrl ?? undefined,
    slug: p.productSlug ?? p.slug ?? undefined,
    imageUrl: p.imageUrl ?? p.image ?? undefined,
    packageText: p.packageText ?? p.package ?? undefined,
    minimumText: p.minimumText ?? undefined,
    price: price.amount ?? money(p.price),
    unitPrice: unit.amount,
    unitPriceBasis: unit.per,
    availability: p.availability ?? undefined,
    favorite: Boolean(p.favorite),
    source,
  };
}

export function normaliseProducts(data: unknown, source: Product["source"]): Product[] {
  const list = pickArray(data, ["products", "product", "items", "results", "hits", "entries"]);
  const rows = list.length > 0 ? list : [asRecord(data)];
  return rows.map((p) => normaliseProduct(p, source)).filter((p) => p.id && p.name);
}

export function normaliseCart(data: unknown): Cart {
  const rec = asRecord(data);
  const items = pickArray(rec, ["items", "lines"]).map((raw): CartLine => {
    const line = asRecord(raw);
    const qtyRaw = line.quantity ?? line.quantitySelector ?? {};
    const qty =
      typeof qtyRaw === "number"
        ? qtyRaw
        : Number(qtyRaw.value ?? qtyRaw.quantity?.value ?? qtyRaw.quantity ?? 0);
    return {
      productId: String(line.productId ?? line.id ?? ""),
      cartItemId: line.cartItemId ?? undefined,
      name: String(line.name ?? line.productName ?? "").trim(),
      quantity: Number.isFinite(qty) ? qty : 0,
      unit: String(qtyRaw.unit ?? qtyRaw.quantity?.unit ?? line.unit ?? "un"),
      price: priceTag(line.price).amount ?? money(line.price),
      lineTotal: money(line.lineTotal),
    };
  });

  const totalsRaw = asRecord(rec.totals);
  const totals = {
    products: money(totalsRaw.products),
    bags: money(totalsRaw.bags),
    deposit: money(totalsRaw.deposit),
    delivery: money(totalsRaw.delivery),
    discounts: money(totalsRaw.discounts),
    grandTotal: money(totalsRaw.grandTotal),
    estimated: Boolean(totalsRaw.estimated),
  };

  const checkoutRaw = asRecord(rec.checkout);
  const checkout =
    Object.keys(checkoutRaw).length > 0
      ? {
          minimumOrder: money(checkoutRaw.minimumOrder),
          meetsMinimum:
            typeof checkoutRaw.meetsMinimum === "boolean" ? checkoutRaw.meetsMinimum : null,
          entregaZero:
            typeof checkoutRaw.entregaZero === "boolean" ? checkoutRaw.entregaZero : null,
          freeDeliveryFrom: money(checkoutRaw.freeDeliveryFrom),
          deliveryFee: checkoutRaw.deliveryFee ?? null,
        }
      : undefined;

  return {
    observedAt: rec.observedAt,
    authenticated: Boolean(rec.customerAuthenticated ?? rec.authenticated ?? true),
    items: items.filter((i) => i.productId || i.name),
    totals,
    checkout,
  };
}

export function normaliseOrder(raw: unknown): Order {
  const o = asRecord(raw);
  const lines = pickArray(o, ["lines", "items", "products"]).map((rawLine): OrderLine => {
    const l = asRecord(rawLine);
    return {
      productId: l.productId ? String(l.productId) : undefined,
      name: String(l.name ?? l.productName ?? "").trim(),
      quantity: typeof l.quantity === "number" ? l.quantity : l.quantity?.value,
      lineTotal: money(l.lineTotal),
    };
  });
  return {
    id: String(o.orderId ?? o.id ?? o.orderNumber ?? ""),
    number: o.orderNumber ? String(o.orderNumber) : undefined,
    placedAt: o.placedAt ?? o.date ?? undefined,
    lines: lines.filter((l) => l.name || l.productId),
  };
}

export function normaliseOrders(data: unknown): Order[] {
  return pickArray(data, ["orders", "items", "results"]).map(normaliseOrder);
}

export function normaliseLabels(raw: unknown): ProductLabels {
  const outer = asRecord(raw);
  // `get_product_labels` nests the label under `label`; other shapes are flat.
  const label = asRecord(outer.label ?? outer);
  const ingredients = label.ingredients ?? label.ingredientsText ?? outer.ingredients;
  const allergens =
    label.allergenStatement ??
    label.allergens ??
    (Array.isArray(label.emphasised) ? label.emphasised.join(", ") : undefined) ??
    outer.allergens;
  const mayContain = label.mayContain ?? label.traces ?? outer.mayContain;
  const flatten = (value: unknown): string | undefined => {
    if (typeof value === "string") return value;
    if (Array.isArray(value)) {
      return value
        .map((v) => (typeof v === "string" ? v : String(asRecord(v).name ?? "")))
        .filter(Boolean)
        .join(", ");
    }
    return undefined;
  };
  return {
    productId: String(outer.productId ?? label.productId ?? ""),
    ingredients: flatten(ingredients),
    allergens: flatten(allergens),
    mayContain: flatten(mayContain),
    raw,
  };
}
