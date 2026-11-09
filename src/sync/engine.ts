import type { BringProvider } from "../bring/provider.js";
import type { AppConfig } from "../config/index.js";
import type { ContinenteAdapter } from "../continente/adapter.js";
import type { Logger } from "../logger.js";
import type { Resolver } from "../matcher/resolver.js";
import { mappingKey, specMultiplier } from "../matcher/score.js";
import type { Notifier } from "../notify.js";
import type { PolicyEngine } from "../policy/engine.js";
import type { ProductFactsService } from "../policy/facts.js";
import type { Store } from "../store/index.js";
import type {
  BringItem,
  BringList,
  BringSnapshot,
  Cart,
  Mapping,
  Product,
  StoredBringItem,
} from "../types.js";

type PlanOp = {
  productId: string;
  delta: number;
  itemUuid: string;
  product?: Product;
  multiplier: number;
};

interface Aggregated {
  delta: number;
  uuids: Set<string>;
  product?: Product;
}

export interface SyncStatus {
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

export interface SyncDeps {
  config: AppConfig;
  bring: BringProvider;
  adapter: ContinenteAdapter;
  resolver: Resolver;
  policy: PolicyEngine;
  facts: ProductFactsService;
  store: Store;
  notifier: Notifier;
  logger: Logger;
}

export class SyncEngine {
  private list: BringList | null = null;
  private started = false;
  private paused: boolean;
  private pollTimer: NodeJS.Timeout | null = null;
  private cartTimer: NodeJS.Timeout | null = null;
  private polling = false;
  private cartBusy = false;
  private failures = 0;
  private lastPollAt: string | null = null;
  private lastPollError: string | null = null;
  private lastCartAt: string | null = null;
  private continenteError: string | null = null;
  private bringError: string | null = null;
  private lastCart: Cart | null = null;

  constructor(private readonly deps: SyncDeps) {
    this.paused = deps.store.getSetting("paused") === "1";
  }

  // ---- lifecycle ---------------------------------------------------------

  start(): void {
    if (this.started) return;
    this.started = true;
    void this.tick();
    this.cartTimer = setInterval(
      () => void this.checkCart().catch(() => undefined),
      this.deps.config.continente.cartCheckSeconds * 1000,
    );
    this.cartTimer.unref();
  }

  stop(): void {
    this.started = false;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    if (this.cartTimer) clearInterval(this.cartTimer);
    this.pollTimer = null;
    this.cartTimer = null;
  }

  private schedule(): void {
    if (!this.started) return;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = setTimeout(() => {
      void this.tick().finally(() => this.schedule());
    }, this.deps.config.bring.pollSeconds * 1000);
    this.pollTimer.unref();
  }

  async pollNow(): Promise<void> {
    await this.tick();
  }

  // ---- status ------------------------------------------------------------

  status(): SyncStatus {
    const items = this.list ? this.deps.store.listBringItems(this.list.listUuid) : [];
    const open = items.filter((i) => i.state === "open");
    const mapped = open.filter((i) => i.mappingId != null);
    const needsReview = open.filter(
      (i) =>
        i.mappingId == null &&
        i.resolutionStatus != null &&
        !["ignored", "excluded", "resolved"].includes(i.resolutionStatus),
    );
    const excluded = open.filter((i) => i.resolutionStatus === "excluded");
    return {
      running: this.started && !this.paused,
      paused: this.paused,
      dryRun: this.deps.config.dryRun,
      lastPollAt: this.lastPollAt,
      lastPollError: this.lastPollError,
      bring: {
        ok: this.bringError === null,
        listName: this.list?.name ?? null,
        error: this.bringError,
      },
      continente: {
        ok: this.continenteError === null,
        lastCartAt: this.lastCartAt,
        error: this.continenteError,
      },
      counts: {
        open: open.length,
        mapped: mapped.length,
        needsReview: needsReview.length,
        excluded: excluded.length,
        cartLines: this.lastCart?.items.length ?? this.deps.store.listCartLinks().length,
      },
      cart: this.lastCart,
      pendingCheckout: this.deps.store.pendingCheckouts().length,
    };
  }

  listItems(): StoredBringItem[] {
    return this.list ? this.deps.store.listBringItems(this.list.listUuid) : [];
  }

  getCart(): Cart | null {
    return this.lastCart;
  }

  async pause(): Promise<void> {
    this.paused = true;
    this.deps.store.setSetting("paused", "1");
    this.deps.store.addEvent("info", "sync", "Sync paused");
  }

  async resume(): Promise<void> {
    this.paused = false;
    this.deps.store.setSetting("paused", "0");
    this.deps.store.addEvent("info", "sync", "Sync resumed");
    await this.tick();
  }

  // ---- polling -----------------------------------------------------------

  private async tick(): Promise<void> {
    if (this.paused || this.polling) return;
    this.polling = true;
    try {
      if (!this.list) {
        this.list = await this.deps.bring.resolveList(this.deps.config.bring.list);
        this.deps.store.upsertList(this.list.listUuid, this.list.name);
        this.deps.logger.info(`Using Bring list "${this.list.name}"`);
      }

      const snapshot = await this.deps.bring.getList(this.list);
      this.bringError = null;
      this.lastPollAt = new Date().toISOString();
      this.lastPollError = null;
      this.failures = 0;

      if (!snapshot.notModified) {
        await this.syncSnapshot(snapshot);
      }
    } catch (error) {
      this.failures += 1;
      this.lastPollError = String(error);
      this.bringError = String(error);
      this.lastPollAt = new Date().toISOString();
      this.deps.logger.error("Bring poll failed", { error: String(error) });
      if (this.failures === 3) {
        await this.deps.notifier.send({
          title: "Bring sync is failing",
          message: String(error).slice(0, 400),
          priority: "high",
          tags: ["warning"],
          click: this.url("/"),
        });
      }
    } finally {
      this.polling = false;
      this.schedule();
    }
  }

  private async syncSnapshot(snapshot: BringSnapshot): Promise<void> {
    if (!this.list) return;
    const listUuid = this.list.listUuid;
    const known = this.deps.store.listBringItems(listUuid);
    const knownByUuid = new Map(known.map((i) => [i.uuid, i]));
    const openNow = new Map(snapshot.purchase.map((i) => [i.uuid, i]));
    const recently = new Set(snapshot.recently.map((i) => i.uuid));
    const plan: PlanOp[] = [];

    // Items that disappeared from "to buy": completed or deleted.
    for (const item of known) {
      if (item.state !== "open" || openNow.has(item.uuid)) continue;
      const completed = recently.has(item.uuid);
      this.deps.store.markItemSeen({
        uuid: item.uuid,
        listUuid,
        itemId: item.itemId,
        specification: item.specification,
        state: completed ? "completed" : "removed",
      });
      if (completed && item.completedByUs) {
        continue;
      }
      if (completed && this.deps.config.sync.onComplete === "ignore") continue;
      if (!item.mappingId || item.suppressed) continue;

      const mapping = this.deps.store.getMapping(item.mappingId);
      if (!mapping) continue;
      plan.push({
        productId: mapping.productId,
        delta: -this.multiplier(item, mapping),
        itemUuid: item.uuid,
        multiplier: this.multiplier(item, mapping),
      });
    }

    // New, re-added or renamed items.
    for (const item of snapshot.purchase) {
      const existing = knownByUuid.get(item.uuid);
      let changed = true;
      if (existing) {
        changed =
          existing.state !== "open" ||
          existing.itemId !== item.itemId ||
          existing.specification !== item.specification;
      }

      if (!changed) {
        this.deps.store.markItemSeen({
          uuid: item.uuid,
          listUuid,
          itemId: item.itemId,
          specification: item.specification,
          state: "open",
        });
        continue;
      }

      if (existing?.state === "open" && existing.mappingId) {
        // Renamed in place: take the previous contribution out first.
        const previous = this.deps.store.getMapping(existing.mappingId);
        if (previous) {
          plan.push({
            productId: previous.productId,
            delta: -this.multiplier(existing, previous),
            itemUuid: item.uuid,
            multiplier: this.multiplier(existing, previous),
          });
        }
      }

      this.deps.store.markItemSeen({
        uuid: item.uuid,
        listUuid,
        itemId: item.itemId,
        specification: item.specification,
        state: "open",
      });
      this.deps.store.setCompletedByUs(item.uuid, false);
      this.deps.store.setSuppressed(item.uuid, false);

      // "Ignore" sticks until the item itself changes.
      await this.resolveAndPlan(item, plan);
    }

    await this.applyPlan(plan);
  }

  private multiplier(item: Pick<BringItem, "specification">, mapping: Mapping): number {
    return Math.max(1, Math.round(specMultiplier(item.specification) * mapping.multiplier));
  }

  private async resolveAndPlan(item: BringItem, plan: PlanOp[]): Promise<void> {
    const resolution = await this.deps.resolver.resolve(item);
    if (!this.list) return;

    switch (resolution.status) {
      case "resolved": {
        const mapping = this.deps.store.getMapping(resolution.mappingId);
        const multiplier = mapping
          ? this.multiplier(item, mapping)
          : specMultiplier(item.specification);
        this.deps.store.setItemMapping(item.uuid, resolution.mappingId);
        this.deps.store.setItemResolution(item.uuid, "resolved", resolution.reason);
        plan.push({
          productId: resolution.product.id,
          delta: multiplier,
          itemUuid: item.uuid,
          product: resolution.product,
          multiplier: resolution.multiplier,
        });
        return;
      }
      case "needs_review":
      case "unsafe":
      case "no_match": {
        this.deps.store.setItemMapping(item.uuid, null);
        this.deps.store.setItemResolution(item.uuid, resolution.status, resolution.reason);
        await this.notifyReview(item, resolution.status, resolution.reason);
        return;
      }
      case "excluded": {
        this.deps.store.setItemMapping(item.uuid, null);
        this.deps.store.setItemResolution(item.uuid, "excluded", resolution.reason);
        this.deps.store.addEvent("info", "policy", `Leaving "${item.itemId}" for you to buy`, {
          reason: resolution.reason,
        });
        return;
      }
    }
  }

  private async notifyReview(item: BringItem, status: string, reason: string): Promise<void> {
    const stored = this.deps.store.getBringItem(item.uuid);
    if (!stored) return;
    if (stored.notifiedAt) {
      const age = Date.now() - Date.parse(stored.notifiedAt);
      if (age < 24 * 60 * 60 * 1000) return;
    }
    this.deps.store.markNotified(item.uuid);
    this.deps.store.addEvent("warn", "review", `"${item.itemId}" needs a decision`, {
      status,
      reason,
    });
    await this.deps.notifier.send({
      title: "Bring item needs a decision",
      message: `"${item.itemId}"${item.specification ? ` (${item.specification})` : ""}: ${reason}`,
      priority: "default",
      tags: ["shopping"],
      click: this.url("/queue"),
      actions: [{ action: "view", label: "Escolher", url: this.url("/queue") }],
    });
  }

  // ---- cart writes -------------------------------------------------------

  private async applyPlan(ops: PlanOp[]): Promise<void> {
    if (ops.length === 0) return;
    const aggregated = new Map<string, Aggregated>();
    for (const op of ops) {
      if (!op.productId) continue;
      const entry = aggregated.get(op.productId) ?? { delta: 0, uuids: new Set<string>() };
      entry.delta += op.delta;
      entry.uuids.add(op.itemUuid);
      if (op.product) entry.product = op.product;
      aggregated.set(op.productId, entry);
    }

    let cart: Cart;
    try {
      cart = await this.deps.adapter.getCart();
      this.noteCart(cart);
    } catch (error) {
      this.continenteError = String(error);
      this.deps.logger.error("Could not read the Continente cart", { error: String(error) });
      return;
    }

    const current = new Map<string, number>();
    for (const line of cart.items) current.set(line.productId, line.quantity);

    const targets: Array<{ productId: string; delta: number; target: number; entry: Aggregated }> =
      [];
    let extraCost = 0;
    for (const [productId, entry] of aggregated) {
      const target = Math.max(0, (current.get(productId) ?? 0) + entry.delta);
      if (entry.delta > 0 && entry.product?.price) {
        extraCost += entry.delta * entry.product.price;
      }
      targets.push({ productId, delta: entry.delta, target, entry });
    }

    const max = this.deps.config.sync.maxCartEur;
    const currentTotal = cart.totals.grandTotal ?? 0;
    if (max > 0 && currentTotal + extraCost > max) {
      this.deps.store.addEvent("warn", "budget", "Cart budget exceeded; holding changes", {
        currentTotal,
        extraCost,
        max,
      });
      await this.deps.notifier.send({
        title: "Cart budget exceeded",
        message: `The cart would reach about €${(currentTotal + extraCost).toFixed(2)} (limit €${max.toFixed(2)}). Nothing was added.`,
        priority: "high",
        tags: ["warning"],
        click: this.url("/"),
      });
      return;
    }

    for (const { productId, delta, target, entry } of targets) {
      if (Math.abs(delta) < 1e-9) continue;
      const intent = this.deps.store.createIntent(productId, delta, [...entry.uuids][0] ?? null);
      if (this.deps.config.dryRun) {
        this.deps.store.addEvent("info", "dry-run", `Would set ${productId} to ${target}`, {
          delta,
          target,
        });
        this.deps.store.completeIntent(intent);
        continue;
      }
      try {
        const updated = await this.deps.adapter.setQuantity(productId, target);
        this.noteCart(updated);
        this.deps.store.completeIntent(intent);
        this.updateLink(productId, target, entry.uuids, delta);
        this.deps.store.addEvent("info", "cart", `Set cart line ${productId} to ${target}`, {
          delta,
        });
      } catch (error) {
        this.deps.store.failIntent(intent, String(error));
        this.continenteError = String(error);
        this.deps.logger.error(`Cart write failed for ${productId}`, { error: String(error) });
        for (const uuid of entry.uuids) {
          this.deps.store.setItemResolution(uuid, "error", `Cart write failed: ${String(error)}`);
        }
        await this.deps.notifier.send({
          title: "Cart change failed",
          message: String(error).slice(0, 400),
          priority: "high",
          tags: ["warning"],
          click: this.url("/queue"),
        });
        return;
      }
    }
  }

  private updateLink(productId: string, target: number, uuids: Set<string>, delta: number): void {
    if (target <= 0) {
      this.deps.store.deleteCartLink(productId);
      return;
    }
    const existing = this.deps.store.getCartLink(productId);
    const set = new Set(existing?.bringUuids ?? []);
    if (delta > 0) for (const uuid of uuids) set.add(uuid);
    else for (const uuid of uuids) set.delete(uuid);
    this.deps.store.setCartLink({
      productId,
      qty: target,
      bringUuids: [...set],
      managed: true,
    });
  }

  // ---- cart inspection / checkout ---------------------------------------

  async checkCart(): Promise<void> {
    if (this.paused || this.cartBusy || this.polling) return;
    if (this.deps.store.listCartLinks().length === 0) return;
    this.cartBusy = true;
    try {
      const cart = await this.deps.adapter.getCart();
      this.noteCart(cart);
      const lines = cart.items.filter((l) => l.name || l.productId);
      if (lines.length === 0) {
        await this.detectCheckout();
        return;
      }
      for (const link of this.deps.store.listCartLinks()) {
        const line = lines.find((l) => l.productId === link.productId);
        const actual = line?.quantity ?? 0;
        if (actual + 1e-9 < link.qty) {
          for (const uuid of link.bringUuids) this.deps.store.setSuppressed(uuid, true);
          this.deps.store.addEvent(
            "info",
            "cart",
            `You changed the cart line for ${link.productId}; keeping your edit`,
            { expected: link.qty, actual },
          );
          if (actual <= 0) this.deps.store.deleteCartLink(link.productId);
          else this.deps.store.setCartLink({ ...link, qty: actual });
        }
      }
    } catch (error) {
      this.continenteError = String(error);
      this.deps.logger.warn("Cart check failed", { error: String(error) });
    } finally {
      this.cartBusy = false;
    }
  }

  private async detectCheckout(): Promise<void> {
    if (this.deps.config.sync.checkoutMode === "off") return;
    const lastCheck = this.deps.store.getSetting("last_order_check_at");
    if (lastCheck && Date.now() - Date.parse(lastCheck) < 5 * 60 * 1000) return;
    this.deps.store.setSetting("last_order_check_at", new Date().toISOString());

    const orders = await this.deps.adapter.listOrders(1).catch((error) => {
      this.deps.logger.warn("Could not read orders", { error: String(error) });
      return [];
    });
    const latest = orders[0];
    if (!latest?.id || this.deps.store.hasOrder(latest.id)) return;

    this.deps.store.saveOrder(latest);
    const linked = this.openItemsWithMappings();
    const matched = linked.filter((item) => this.itemInOrder(item, latest.lines));
    this.deps.store.addEvent("info", "checkout", `Order ${latest.number ?? latest.id} detected`, {
      matched: matched.length,
    });
    if (matched.length === 0) return;

    if (this.deps.config.sync.checkoutMode === "auto") {
      await this.completeItems(matched);
      return;
    }
    this.deps.store.createCheckout(
      latest,
      matched.map((i) => i.uuid),
    );
    await this.deps.notifier.send({
      title: "Order placed — tidy the Bring list?",
      message: `${matched.length} item(s) from the cart can be checked off in Bring. Meat, fish and produce stay on the list.`,
      priority: "default",
      tags: ["white_check_mark"],
      click: this.url("/checkout"),
      actions: [{ action: "view", label: "Rever", url: this.url("/checkout") }],
    });
  }

  private itemInOrder(
    item: StoredBringItem,
    lines: Array<{ productId?: string; name: string }>,
  ): boolean {
    if (!item.mappingId) return false;
    const mapping = this.deps.store.getMapping(item.mappingId);
    if (!mapping) return false;
    return lines.some(
      (line) =>
        line.productId === mapping.productId ||
        (line.name && line.name.toLowerCase() === mapping.productName.toLowerCase()),
    );
  }

  private openItemsWithMappings(): StoredBringItem[] {
    return this.listItems().filter((i) => i.state === "open" && i.mappingId != null);
  }

  async completeCheckout(id: number): Promise<number> {
    const pending = this.deps.store.pendingCheckouts().find((p) => p.id === id);
    if (!pending) return 0;
    const items = this.listItems().filter((i) => pending.bringUuids.includes(i.uuid));
    const count = await this.completeItems(items);
    this.deps.store.resolveCheckout(id, "confirmed");
    return count;
  }

  dismissCheckout(id: number): void {
    this.deps.store.resolveCheckout(id, "dismissed");
  }

  private async completeItems(items: StoredBringItem[]): Promise<number> {
    if (!this.list || items.length === 0) return 0;
    const bringItems: BringItem[] = items.map((i) => ({
      uuid: i.uuid,
      itemId: i.itemId,
      specification: i.specification,
    }));
    try {
      await this.deps.bring.complete(this.list.listUuid, bringItems);
    } catch (error) {
      this.deps.logger.error("Could not check items off in Bring", { error: String(error) });
      await this.deps.notifier.send({
        title: "Could not update the Bring list",
        message: String(error).slice(0, 400),
        priority: "high",
        tags: ["warning"],
      });
      return 0;
    }
    for (const item of items) {
      this.deps.store.setCompletedByUs(item.uuid, true);
      this.deps.store.markItemSeen({
        uuid: item.uuid,
        listUuid: this.list.listUuid,
        itemId: item.itemId,
        specification: item.specification,
        state: "completed",
        mappingId: item.mappingId,
      });
      if (item.mappingId) {
        const mapping = this.deps.store.getMapping(item.mappingId);
        if (mapping) this.deps.store.deleteCartLink(mapping.productId);
      }
    }
    this.deps.store.addEvent("info", "checkout", `Checked ${items.length} item(s) off in Bring`);
    await this.deps.notifier.send({
      title: "Bring list updated",
      message: `${items.length} item(s) checked off. The rest is for you to buy.`,
      tags: ["white_check_mark"],
      click: this.url("/"),
    });
    return items.length;
  }

  // ---- user actions ------------------------------------------------------

  async candidates(uuid: string): Promise<{
    item: StoredBringItem;
    allowed: Array<{ product: Product; score: number; reasons: string[] }>;
    blocked: Array<{ product: Product; reason: string }>;
  }> {
    const item = this.deps.store.getBringItem(uuid);
    if (!item) throw new Error("Unknown Bring item");
    const { allowed, blocked } = await this.deps.resolver.candidates({
      uuid: item.uuid,
      itemId: item.itemId,
      specification: item.specification,
    });
    return { item, allowed, blocked };
  }

  async mappingCandidates(mappingId: number): Promise<{
    mapping: Mapping;
    allowed: Array<{ product: Product; score: number; reasons: string[] }>;
    blocked: Array<{ product: Product; reason: string }>;
  }> {
    const mapping = this.deps.store.getMapping(mappingId);
    if (!mapping) throw new Error("Unknown mapping");
    const { allowed, blocked } = await this.deps.resolver.candidates({
      uuid: `mapping-${mappingId}`,
      itemId: mapping.bringName,
      specification: mapping.bringSpec ?? "",
    });
    return { mapping, allowed, blocked };
  }

  /** Replaces the product behind an existing mapping and fixes the cart lines using it. */
  async swapMapping(mappingId: number, product: Product): Promise<Mapping> {
    const previous = this.deps.store.getMapping(mappingId);
    if (!previous) throw new Error("Mapping not found");
    const facts = await this.deps.facts.get(product);
    const decision = this.deps.policy.evaluate(product, facts);
    if (!decision.allow) throw new Error(decision.reason);

    const updated =
      this.deps.store.updateMapping(mappingId, {
        product,
        source: "user",
        verdict: decision.verdict,
        verdictReason: decision.reason,
      }) ?? previous;

    const plan: PlanOp[] = [];
    if (previous.productId !== product.id) {
      const affected = this.listItems().filter(
        (item) => item.mappingId === mappingId && item.state === "open",
      );
      for (const item of affected) {
        plan.push({
          productId: previous.productId,
          delta: -this.multiplier(item, previous),
          itemUuid: item.uuid,
          multiplier: previous.multiplier,
        });
        plan.push({
          productId: product.id,
          delta: this.multiplier(item, updated),
          itemUuid: item.uuid,
          product,
          multiplier: updated.multiplier,
        });
        this.deps.store.setSuppressed(item.uuid, false);
      }
    }
    await this.applyPlan(plan);
    return updated;
  }

  async pick(uuid: string, productId: string): Promise<Mapping> {
    const item = this.deps.store.getBringItem(uuid);
    if (!item) throw new Error("Unknown Bring item");
    const product = await this.deps.adapter.getProduct(productId);
    if (!product) throw new Error("Product not found in Continente");
    const facts = await this.deps.facts.get(product);
    const decision = this.deps.policy.evaluate(product, facts);
    if (!decision.allow) throw new Error(decision.reason);

    const previous = item.mappingId ? this.deps.store.getMapping(item.mappingId) : null;
    const mapping = this.deps.store.upsertMapping({
      normKey: mappingKey({ itemId: item.itemId }),
      bringName: item.itemId,
      bringSpec: item.specification || null,
      product,
      source: "user",
      confidence: 1,
      multiplier: previous?.multiplier ?? 1,
      verdict: decision.verdict,
      verdictReason: decision.reason,
    });
    this.deps.store.setItemMapping(item.uuid, mapping.id);
    this.deps.store.setItemResolution(item.uuid, "resolved", "Picked by you");
    this.deps.store.setSuppressed(item.uuid, false);

    if (previous?.productId === product.id) return mapping;

    if (previous && previous.productId !== product.id) {
      await this.applyPlan([
        {
          productId: previous.productId,
          delta: -this.multiplier(item, previous),
          itemUuid: item.uuid,
          multiplier: this.multiplier(item, previous),
        },
      ]);
    }
    await this.applyPlan([
      {
        productId: product.id,
        delta: this.multiplier(item, mapping),
        itemUuid: item.uuid,
        product,
        multiplier: mapping.multiplier,
      },
    ]);
    return mapping;
  }

  async ignore(uuid: string): Promise<void> {
    const item = this.deps.store.getBringItem(uuid);
    if (!item) return;
    if (item.mappingId) {
      const mapping = this.deps.store.getMapping(item.mappingId);
      if (mapping) {
        await this.applyPlan([
          {
            productId: mapping.productId,
            delta: -this.multiplier(item, mapping),
            itemUuid: item.uuid,
            multiplier: mapping.multiplier,
          },
        ]);
      }
    }
    this.deps.store.setSuppressed(uuid, true);
    this.deps.store.setItemResolution(uuid, "ignored", "Ignored by you");
  }

  async retry(uuid: string): Promise<void> {
    const item = this.deps.store.getBringItem(uuid);
    if (!item) return;
    if (item.mappingId) {
      const mapping = this.deps.store.getMapping(item.mappingId);
      const link = mapping ? this.deps.store.getCartLink(mapping.productId) : null;
      if (link?.bringUuids.includes(uuid)) {
        this.deps.store.setItemResolution(uuid, "resolved", "Still in the cart");
        return;
      }
    }
    this.deps.store.setItemResolution(uuid, "open", null);
    const plan: PlanOp[] = [];
    await this.resolveAndPlan(
      { uuid: item.uuid, itemId: item.itemId, specification: item.specification },
      plan,
    );
    await this.applyPlan(plan);
  }

  async reconcile(): Promise<void> {
    if (!this.list) throw new Error("Bring list not loaded");
    const snapshot = await this.deps.bring.getList(this.list);
    const known = new Map(this.listItems().map((i) => [i.uuid, i]));
    const plan: PlanOp[] = [];

    for (const item of snapshot.purchase) {
      const stored = known.get(item.uuid);
      if (stored?.mappingId) {
        const mapping = this.deps.store.getMapping(stored.mappingId);
        if (mapping) {
          plan.push({
            productId: mapping.productId,
            delta: this.multiplier(item, mapping),
            itemUuid: item.uuid,
            product: productFromMapping(mapping),
            multiplier: mapping.multiplier,
          });
          continue;
        }
      }
      await this.resolveAndPlan(item, plan);
    }

    // Lines we manage that no longer correspond to an open item go away.
    for (const link of this.deps.store.listCartLinks()) {
      if (!plan.some((op) => op.productId === link.productId)) {
        plan.push({
          productId: link.productId,
          delta: -link.qty,
          itemUuid: "",
          multiplier: 1,
        });
      }
    }
    await this.applyPlan(plan);
    this.deps.store.addEvent("info", "sync", "Manual reconcile completed");
  }

  private noteCart(cart: Cart): void {
    this.lastCart = cart;
    this.lastCartAt = new Date().toISOString();
    this.continenteError = null;
  }

  private url(path: string): string {
    const base = this.deps.config.publicUrl.replace(/\/$/, "");
    return base ? `${base}${path}` : path;
  }
}

function productFromMapping(mapping: Mapping): Product {
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
