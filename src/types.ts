/** Domain types shared by the pollers, resolver, sync engine and web UI. */

export interface BringItem {
  uuid: string;
  itemId: string;
  specification: string;
}

export interface BringList {
  listUuid: string;
  name: string;
  theme?: string;
}

export interface BringSnapshot {
  listUuid: string;
  listName: string;
  purchase: BringItem[];
  recently: BringItem[];
  /** True when the provider answered 304 Not Modified and the snapshot came from cache. */
  notModified?: boolean;
}

/** A product as exposed by the Continente adapter, normalised across sources. */
export interface Product {
  id: string;
  name: string;
  brand?: string;
  category?: string;
  url?: string;
  slug?: string;
  imageUrl?: string;
  packageText?: string;
  minimumText?: string;
  /** Pack price in EUR. */
  price?: number;
  /** Price per kg/l/un when the storefront provides one. */
  unitPrice?: number;
  unitPriceBasis?: string;
  availability?: string;
  favorite?: boolean;
  source?: "search" | "history" | "favorites";
}

export interface CartLine {
  productId: string;
  cartItemId?: string;
  name: string;
  quantity: number;
  unit: string;
  price?: number;
  lineTotal?: number;
}

export interface CartTotals {
  products?: number;
  bags?: number;
  deposit?: number;
  delivery?: number;
  discounts?: number;
  grandTotal?: number;
  estimated?: boolean;
}

export interface CartCheckout {
  minimumOrder?: number;
  meetsMinimum?: boolean | null;
  entregaZero?: boolean | null;
  freeDeliveryFrom?: number | null;
  deliveryFee?: string | null;
}

export interface Cart {
  observedAt?: string;
  authenticated: boolean;
  items: CartLine[];
  totals: CartTotals;
  checkout?: CartCheckout;
}

export interface OrderLine {
  productId?: string;
  name: string;
  quantity?: number;
  lineTotal?: number;
}

export interface Order {
  id: string;
  number?: string;
  placedAt?: string;
  lines: OrderLine[];
}

export interface ProductLabels {
  productId: string;
  ingredients?: string;
  allergens?: string;
  mayContain?: string;
  raw?: unknown;
}

/** Evidence used to decide whether a product is safe for a coeliac diet. */
export interface GlutenFacts {
  productId: string;
  name: string;
  category?: string;
  productUrl?: string;
  /** Continente's own "Sem Glúten" badge on the product page. */
  hasGlutenFreeBadge: boolean;
  /** "sem glúten" in the product name. */
  nameSaysGlutenFree: boolean;
  /** Parsed label text, when available. */
  ingredients?: string;
  allergens?: string;
  labels?: ProductLabels;
  checkedAt: string;
}

export type GlutenVerdict = "certified" | "naturally_gf" | "risk" | "unknown";

export type PolicyKind = "ok" | "excluded" | "unsafe";

export interface PolicyDecision {
  allow: boolean;
  kind: PolicyKind;
  verdict: GlutenVerdict;
  reason: string;
}

export interface Mapping {
  id: number;
  normKey: string;
  bringName: string;
  bringSpec: string | null;
  productId: string;
  productName: string;
  brand: string | null;
  category: string | null;
  packageText: string | null;
  productUrl: string | null;
  imageUrl: string | null;
  source: "seed" | "heuristic" | "llm" | "user";
  confidence: number | null;
  multiplier: number;
  verdict: GlutenVerdict;
  verdictReason: string | null;
  verifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type BringItemState = "open" | "completed" | "removed";

export interface StoredBringItem {
  uuid: string;
  listUuid: string;
  itemId: string;
  specification: string;
  state: BringItemState;
  mappingId: number | null;
  suppressed: boolean;
  completedByUs: boolean;
  resolutionStatus: string | null;
  reviewReason: string | null;
  notifiedAt: string | null;
  firstSeen: string;
  lastSeen: string;
}

export interface CartLink {
  productId: string;
  qty: number;
  bringUuids: string[];
  managed: boolean;
}

export type EventLevel = "info" | "warn" | "error";

export interface AppEvent {
  id: number;
  at: string;
  level: EventLevel;
  kind: string;
  message: string;
  data: unknown;
}

export interface PendingCheckout {
  id: number;
  orderId: string;
  orderNumber: string | null;
  bringUuids: string[];
  lines: OrderLine[];
  createdAt: string;
  status: "pending" | "confirmed" | "dismissed";
}
