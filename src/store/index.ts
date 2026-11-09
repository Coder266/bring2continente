import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { FactsCache } from "../policy/facts.js";
import type {
  AppEvent,
  CartLink,
  EventLevel,
  GlutenFacts,
  Mapping,
  Order,
  PendingCheckout,
  Product,
  StoredBringItem,
} from "../types.js";

type Row = Record<string, unknown>;

function str(value: unknown): string {
  return value == null ? "" : String(value);
}
function num(value: unknown): number {
  return value == null ? 0 : Number(value);
}
function nullableStr(value: unknown): string | null {
  return value == null ? null : String(value);
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS lists (
  list_uuid TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS mappings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  norm_key TEXT NOT NULL UNIQUE,
  bring_name TEXT NOT NULL,
  bring_spec TEXT,
  product_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  brand TEXT,
  category TEXT,
  package_text TEXT,
  product_url TEXT,
  image_url TEXT,
  source TEXT NOT NULL,
  confidence REAL,
  multiplier REAL NOT NULL DEFAULT 1,
  verdict TEXT NOT NULL,
  verdict_reason TEXT,
  verified_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bring_items (
  uuid TEXT PRIMARY KEY,
  list_uuid TEXT NOT NULL,
  item_id TEXT NOT NULL,
  specification TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL,
  mapping_id INTEGER,
  suppressed INTEGER NOT NULL DEFAULT 0,
  completed_by_us INTEGER NOT NULL DEFAULT 0,
  resolution_status TEXT,
  review_reason TEXT,
  notified_at TEXT,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cart_links (
  product_id TEXT PRIMARY KEY,
  qty REAL NOT NULL,
  bring_uuids TEXT NOT NULL,
  managed INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS product_facts (
  product_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT,
  product_url TEXT,
  badge_gf INTEGER NOT NULL DEFAULT 0,
  ingredients TEXT,
  allergens TEXT,
  verdict TEXT,
  reason TEXT,
  checked_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS verified_products (
  product_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  verified_at TEXT NOT NULL,
  note TEXT
);

CREATE TABLE IF NOT EXISTS intents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id TEXT NOT NULL,
  delta REAL NOT NULL,
  item_uuid TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  applied_at TEXT
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  level TEXT NOT NULL,
  kind TEXT NOT NULL,
  message TEXT NOT NULL,
  data TEXT
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  number TEXT,
  placed_at TEXT,
  lines TEXT NOT NULL,
  seen_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS checkout_pending (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL,
  order_number TEXT,
  bring_uuids TEXT NOT NULL,
  lines TEXT NOT NULL,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

export class Store implements FactsCache {
  readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(resolve(path)), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec("PRAGMA busy_timeout = 5000");
    this.db.exec(SCHEMA);
    this.ensureColumn("mappings", "category", "TEXT");
    this.ensureColumn("bring_items", "resolution_status", "TEXT");
    this.ensureColumn("bring_items", "review_reason", "TEXT");
    this.ensureColumn("bring_items", "notified_at", "TEXT");
  }

  /** Adds a column to an older database without dropping data. */
  private ensureColumn(table: string, column: string, type: string): void {
    const columns = this.db.prepare(`PRAGMA table_info(${table})`).all() as Row[];
    if (!columns.some((c) => str(c.name) === column)) {
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    }
  }

  close(): void {
    this.db.close();
  }

  // ---- lists -------------------------------------------------------------

  upsertList(listUuid: string, name: string): void {
    this.db
      .prepare(
        "INSERT INTO lists(list_uuid, name) VALUES(?, ?) ON CONFLICT(list_uuid) DO UPDATE SET name=excluded.name",
      )
      .run(listUuid, name);
  }

  // ---- mappings ----------------------------------------------------------

  findMapping(normKey: string): Mapping | null {
    const row = this.db.prepare("SELECT * FROM mappings WHERE norm_key = ?").get(normKey);
    return row ? toMapping(row as Row) : null;
  }

  getMapping(id: number): Mapping | null {
    const row = this.db.prepare("SELECT * FROM mappings WHERE id = ?").get(id);
    return row ? toMapping(row as Row) : null;
  }

  listMappings(): Mapping[] {
    return (this.db.prepare("SELECT * FROM mappings ORDER BY updated_at DESC").all() as Row[]).map(
      toMapping,
    );
  }

  upsertMapping(input: {
    normKey: string;
    bringName: string;
    bringSpec?: string | null;
    product: Product;
    source: Mapping["source"];
    confidence?: number | null;
    multiplier?: number;
    verdict: Mapping["verdict"];
    verdictReason?: string | null;
  }): Mapping {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO mappings(
          norm_key, bring_name, bring_spec, product_id, product_name, brand, category, package_text,
          product_url, image_url, source, confidence, multiplier, verdict, verdict_reason,
          verified_at, created_at, updated_at
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(norm_key) DO UPDATE SET
          bring_name=excluded.bring_name,
          bring_spec=excluded.bring_spec,
          product_id=excluded.product_id,
          product_name=excluded.product_name,
          brand=excluded.brand,
          category=excluded.category,
          package_text=excluded.package_text,
          product_url=excluded.product_url,
          image_url=excluded.image_url,
          source=excluded.source,
          confidence=excluded.confidence,
          multiplier=excluded.multiplier,
          verdict=excluded.verdict,
          verdict_reason=excluded.verdict_reason,
          verified_at=excluded.verified_at,
          updated_at=excluded.updated_at`,
      )
      .run(
        input.normKey,
        input.bringName,
        input.bringSpec ?? null,
        input.product.id,
        input.product.name,
        input.product.brand ?? null,
        input.product.category ?? null,
        input.product.packageText ?? null,
        input.product.url ?? null,
        input.product.imageUrl ?? null,
        input.source,
        input.confidence ?? null,
        input.multiplier ?? 1,
        input.verdict,
        input.verdictReason ?? null,
        input.source === "user" ? now : null,
        now,
        now,
      );
    const mapping = this.findMapping(input.normKey);
    if (!mapping) throw new Error("mapping upsert failed");
    return mapping;
  }

  updateMapping(
    id: number,
    patch: Partial<{
      product: Product;
      multiplier: number;
      verdict: Mapping["verdict"];
      verdictReason: string | null;
      source: Mapping["source"];
    }>,
  ): Mapping | null {
    const current = this.getMapping(id);
    if (!current) return null;
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE mappings SET
          product_id=?, product_name=?, brand=?, category=?, package_text=?, product_url=?, image_url=?,
          multiplier=?, verdict=?, verdict_reason=?, source=?, updated_at=?
        WHERE id=?`,
      )
      .run(
        patch.product?.id ?? current.productId,
        patch.product?.name ?? current.productName,
        patch.product?.brand ?? current.brand,
        patch.product?.category ?? current.category,
        patch.product?.packageText ?? current.packageText,
        patch.product?.url ?? current.productUrl,
        patch.product?.imageUrl ?? current.imageUrl,
        patch.multiplier ?? current.multiplier,
        patch.verdict ?? current.verdict,
        patch.verdictReason === undefined ? current.verdictReason : patch.verdictReason,
        patch.source ?? current.source,
        now,
        id,
      );
    return this.getMapping(id);
  }

  deleteMapping(id: number): void {
    this.db.prepare("DELETE FROM mappings WHERE id = ?").run(id);
    this.db.prepare("UPDATE bring_items SET mapping_id = NULL WHERE mapping_id = ?").run(id);
  }

  // ---- bring items -------------------------------------------------------

  listBringItems(listUuid: string): StoredBringItem[] {
    return (
      this.db.prepare("SELECT * FROM bring_items WHERE list_uuid = ?").all(listUuid) as Row[]
    ).map(toBringItem);
  }

  getBringItem(uuid: string): StoredBringItem | null {
    const row = this.db.prepare("SELECT * FROM bring_items WHERE uuid = ?").get(uuid);
    return row ? toBringItem(row as Row) : null;
  }

  markItemSeen(input: {
    uuid: string;
    listUuid: string;
    itemId: string;
    specification: string;
    state: StoredBringItem["state"];
    mappingId?: number | null;
  }): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO bring_items(uuid, list_uuid, item_id, specification, state, mapping_id, first_seen, last_seen)
         VALUES(?,?,?,?,?,?,?,?)
         ON CONFLICT(uuid) DO UPDATE SET
           item_id=excluded.item_id,
           specification=excluded.specification,
           state=excluded.state,
           mapping_id=COALESCE(excluded.mapping_id, bring_items.mapping_id),
           last_seen=excluded.last_seen`,
      )
      .run(
        input.uuid,
        input.listUuid,
        input.itemId,
        input.specification,
        input.state,
        input.mappingId ?? null,
        now,
        now,
      );
  }

  setItemMapping(uuid: string, mappingId: number | null): void {
    this.db.prepare("UPDATE bring_items SET mapping_id = ? WHERE uuid = ?").run(mappingId, uuid);
  }

  setSuppressed(uuid: string, value: boolean): void {
    this.db
      .prepare("UPDATE bring_items SET suppressed = ? WHERE uuid = ?")
      .run(value ? 1 : 0, uuid);
  }

  setCompletedByUs(uuid: string, value: boolean): void {
    this.db
      .prepare("UPDATE bring_items SET completed_by_us = ? WHERE uuid = ?")
      .run(value ? 1 : 0, uuid);
  }

  setItemResolution(uuid: string, status: string, reason: string | null): void {
    this.db
      .prepare("UPDATE bring_items SET resolution_status = ?, review_reason = ? WHERE uuid = ?")
      .run(status, reason, uuid);
  }

  markNotified(uuid: string): void {
    this.db
      .prepare("UPDATE bring_items SET notified_at = ? WHERE uuid = ?")
      .run(new Date().toISOString(), uuid);
  }

  // ---- cart links --------------------------------------------------------

  getCartLink(productId: string): CartLink | null {
    const row = this.db.prepare("SELECT * FROM cart_links WHERE product_id = ?").get(productId);
    return row ? toCartLink(row as Row) : null;
  }

  listCartLinks(): CartLink[] {
    return (this.db.prepare("SELECT * FROM cart_links").all() as Row[]).map(toCartLink);
  }

  setCartLink(link: CartLink): void {
    this.db
      .prepare(
        `INSERT INTO cart_links(product_id, qty, bring_uuids, managed) VALUES(?,?,?,?)
         ON CONFLICT(product_id) DO UPDATE SET qty=excluded.qty, bring_uuids=excluded.bring_uuids, managed=excluded.managed`,
      )
      .run(link.productId, link.qty, JSON.stringify(link.bringUuids), link.managed ? 1 : 0);
  }

  deleteCartLink(productId: string): void {
    this.db.prepare("DELETE FROM cart_links WHERE product_id = ?").run(productId);
  }

  // ---- facts / verification ---------------------------------------------

  get(productId: string): GlutenFacts | null {
    const row = this.db.prepare("SELECT * FROM product_facts WHERE product_id = ?").get(productId);
    if (!row) return null;
    const r = row as Row;
    return {
      productId: str(r.product_id),
      name: str(r.name),
      category: nullableStr(r.category) ?? undefined,
      productUrl: nullableStr(r.product_url) ?? undefined,
      hasGlutenFreeBadge: num(r.badge_gf) === 1,
      nameSaysGlutenFree: false,
      ingredients: nullableStr(r.ingredients) ?? undefined,
      allergens: nullableStr(r.allergens) ?? undefined,
      checkedAt: str(r.checked_at),
    };
  }

  put(facts: GlutenFacts): void {
    this.db
      .prepare(
        `INSERT INTO product_facts(product_id, name, category, product_url, badge_gf, ingredients, allergens, checked_at)
         VALUES(?,?,?,?,?,?,?,?)
         ON CONFLICT(product_id) DO UPDATE SET
           name=excluded.name, category=excluded.category, product_url=excluded.product_url,
           badge_gf=excluded.badge_gf, ingredients=excluded.ingredients,
           allergens=excluded.allergens, checked_at=excluded.checked_at`,
      )
      .run(
        facts.productId,
        facts.name,
        facts.category ?? null,
        facts.productUrl ?? null,
        facts.hasGlutenFreeBadge ? 1 : 0,
        facts.ingredients ?? null,
        facts.allergens ?? null,
        facts.checkedAt,
      );
  }

  isVerified(productId: string): boolean {
    return Boolean(
      this.db.prepare("SELECT 1 FROM verified_products WHERE product_id = ?").get(productId),
    );
  }

  verifyProduct(product: Product, note?: string): void {
    this.db
      .prepare(
        `INSERT INTO verified_products(product_id, name, verified_at, note) VALUES(?,?,?,?)
         ON CONFLICT(product_id) DO UPDATE SET name=excluded.name, verified_at=excluded.verified_at, note=excluded.note`,
      )
      .run(product.id, product.name, new Date().toISOString(), note ?? null);
  }

  listVerified(): Array<{
    productId: string;
    name: string;
    verifiedAt: string;
    note: string | null;
  }> {
    return (
      this.db.prepare("SELECT * FROM verified_products ORDER BY verified_at DESC").all() as Row[]
    ).map((r) => ({
      productId: str(r.product_id),
      name: str(r.name),
      verifiedAt: str(r.verified_at),
      note: nullableStr(r.note),
    }));
  }

  // ---- intents -----------------------------------------------------------

  createIntent(productId: string, delta: number, itemUuid: string | null): number {
    const result = this.db
      .prepare(
        "INSERT INTO intents(product_id, delta, item_uuid, status, created_at) VALUES(?,?,?,?,?)",
      )
      .run(productId, delta, itemUuid, "pending", new Date().toISOString());
    return Number(result.lastInsertRowid);
  }

  completeIntent(id: number): void {
    this.db
      .prepare("UPDATE intents SET status = 'done', applied_at = ? WHERE id = ?")
      .run(new Date().toISOString(), id);
  }

  failIntent(id: number, error: string): void {
    this.db
      .prepare("UPDATE intents SET status = 'failed', applied_at = ? WHERE id = ?")
      .run(new Date().toISOString(), id);
    this.addEvent("error", "intent", "Cart change failed", { id, error });
  }

  pendingIntents(): Row[] {
    return this.db.prepare("SELECT * FROM intents WHERE status = 'pending'").all() as Row[];
  }

  // ---- events ------------------------------------------------------------

  addEvent(level: EventLevel, kind: string, message: string, data?: unknown): void {
    this.db
      .prepare("INSERT INTO events(at, level, kind, message, data) VALUES(?,?,?,?,?)")
      .run(
        new Date().toISOString(),
        level,
        kind,
        message,
        data === undefined ? null : JSON.stringify(data),
      );
  }

  listEvents(limit = 100): AppEvent[] {
    return (
      this.db.prepare("SELECT * FROM events ORDER BY id DESC LIMIT ?").all(limit) as Row[]
    ).map((r) => ({
      id: num(r.id),
      at: str(r.at),
      level: str(r.level) as EventLevel,
      kind: str(r.kind),
      message: str(r.message),
      data: r.data ? JSON.parse(str(r.data)) : null,
    }));
  }

  // ---- orders / checkout -------------------------------------------------

  hasOrder(id: string): boolean {
    return Boolean(this.db.prepare("SELECT 1 FROM orders WHERE id = ?").get(id));
  }

  saveOrder(order: Order): void {
    this.db
      .prepare(
        `INSERT INTO orders(id, number, placed_at, lines, seen_at) VALUES(?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET lines=excluded.lines, seen_at=excluded.seen_at`,
      )
      .run(
        order.id,
        order.number ?? null,
        order.placedAt ?? null,
        JSON.stringify(order.lines),
        new Date().toISOString(),
      );
  }

  createCheckout(order: Order, bringUuids: string[]): number {
    const result = this.db
      .prepare(
        "INSERT INTO checkout_pending(order_id, order_number, bring_uuids, lines, created_at, status) VALUES(?,?,?,?,?,?)",
      )
      .run(
        order.id,
        order.number ?? null,
        JSON.stringify(bringUuids),
        JSON.stringify(order.lines),
        new Date().toISOString(),
        "pending",
      );
    return Number(result.lastInsertRowid);
  }

  pendingCheckouts(): PendingCheckout[] {
    return (
      this.db
        .prepare("SELECT * FROM checkout_pending WHERE status = 'pending' ORDER BY id DESC")
        .all() as Row[]
    ).map((r) => ({
      id: num(r.id),
      orderId: str(r.order_id),
      orderNumber: nullableStr(r.order_number),
      bringUuids: JSON.parse(str(r.bring_uuids)) as string[],
      lines: JSON.parse(str(r.lines)) as PendingCheckout["lines"],
      createdAt: str(r.created_at),
      status: str(r.status) as PendingCheckout["status"],
    }));
  }

  resolveCheckout(id: number, status: "confirmed" | "dismissed"): void {
    this.db.prepare("UPDATE checkout_pending SET status = ? WHERE id = ?").run(status, id);
  }

  // ---- settings ----------------------------------------------------------

  getSetting(key: string): string | null {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as
      | Row
      | undefined;
    return row ? str(row.value) : null;
  }

  setSetting(key: string, value: string): void {
    this.db
      .prepare(
        "INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      )
      .run(key, value);
  }
}

function toMapping(r: Row): Mapping {
  return {
    id: num(r.id),
    normKey: str(r.norm_key),
    bringName: str(r.bring_name),
    bringSpec: nullableStr(r.bring_spec),
    productId: str(r.product_id),
    productName: str(r.product_name),
    brand: nullableStr(r.brand),
    category: nullableStr(r.category),
    packageText: nullableStr(r.package_text),
    productUrl: nullableStr(r.product_url),
    imageUrl: nullableStr(r.image_url),
    source: str(r.source) as Mapping["source"],
    confidence: r.confidence == null ? null : num(r.confidence),
    multiplier: num(r.multiplier),
    verdict: str(r.verdict) as Mapping["verdict"],
    verdictReason: nullableStr(r.verdict_reason),
    verifiedAt: nullableStr(r.verified_at),
    createdAt: str(r.created_at),
    updatedAt: str(r.updated_at),
  };
}

function toBringItem(r: Row): StoredBringItem {
  return {
    uuid: str(r.uuid),
    listUuid: str(r.list_uuid),
    itemId: str(r.item_id),
    specification: str(r.specification),
    state: str(r.state) as StoredBringItem["state"],
    mappingId: r.mapping_id == null ? null : num(r.mapping_id),
    suppressed: num(r.suppressed) === 1,
    completedByUs: num(r.completed_by_us) === 1,
    resolutionStatus: nullableStr(r.resolution_status),
    reviewReason: nullableStr(r.review_reason),
    notifiedAt: nullableStr(r.notified_at),
    firstSeen: str(r.first_seen),
    lastSeen: str(r.last_seen),
  };
}

function toCartLink(r: Row): CartLink {
  return {
    productId: str(r.product_id),
    qty: num(r.qty),
    bringUuids: JSON.parse(str(r.bring_uuids)) as string[],
    managed: num(r.managed) === 1,
  };
}
