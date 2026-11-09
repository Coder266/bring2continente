export interface Product {
  id: string;
  name: string;
  brand?: string;
  category?: string;
  url?: string;
  imageUrl?: string;
  packageText?: string;
  minimumText?: string;
  price?: number;
  unitPrice?: number;
  unitPriceBasis?: string;
  availability?: string;
  favorite?: boolean;
  source?: string;
}

export interface CartLine {
  productId: string;
  name: string;
  quantity: number;
  unit: string;
  price?: number;
  lineTotal?: number;
}

export interface Cart {
  observedAt?: string;
  authenticated: boolean;
  items: CartLine[];
  totals: {
    products?: number;
    grandTotal?: number;
    estimated?: boolean;
  };
  checkout?: {
    minimumOrder?: number;
    meetsMinimum?: boolean | null;
    deliveryFee?: string | null;
  };
}

export interface Mapping {
  id: number;
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
  verdict: "certified" | "naturally_gf" | "risk" | "unknown";
  verdictReason: string | null;
  updatedAt: string;
}

export interface Item {
  uuid: string;
  itemId: string;
  specification: string;
  state: "open" | "completed" | "removed";
  mappingId: number | null;
  suppressed: boolean;
  resolutionStatus: string | null;
  reviewReason: string | null;
  mapping: Mapping | null;
}

export interface Status {
  running: boolean;
  paused: boolean;
  dryRun: boolean;
  lastPollAt: string | null;
  lastPollError: string | null;
  bring: { ok: boolean; listName: string | null; error: string | null };
  continente: { ok: boolean; lastCartAt: string | null; error: string | null };
  counts: {
    open: number;
    mapped: number;
    needsReview: number;
    excluded: number;
    cartLines: number;
  };
  cart: Cart | null;
  pendingCheckout: number;
}

export interface Event {
  id: number;
  at: string;
  level: "info" | "warn" | "error";
  kind: string;
  message: string;
  data: unknown;
}

export interface Candidate {
  product: Product;
  score: number;
  reasons: string[];
}

export interface Candidates {
  item: Item;
  allowed: Candidate[];
  blocked: Array<{ product: Product; reason: string }>;
}

export interface PendingCheckout {
  id: number;
  orderId: string;
  orderNumber: string | null;
  bringUuids: string[];
  lines: Array<{ productId?: string; name: string; quantity?: number }>;
  createdAt: string;
}

export interface Rules {
  glutenMode: "strict" | "standard" | "off";
  excludedCategories: string[];
  nonFoodPrefixes: string[];
  verifiedProducts: Array<{
    productId: string;
    name: string;
    verifiedAt: string;
    note: string | null;
  }>;
  llm: "none" | "opencode" | "openai";
  autoThreshold: number;
  autoMargin: number;
}
