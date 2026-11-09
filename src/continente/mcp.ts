import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Logger } from "../logger.js";
import type { Cart, Order, Product, ProductLabels } from "../types.js";
import {
  assertOk,
  type ContinenteAdapter,
  ContinenteError,
  normaliseCart,
  normaliseLabels,
  normaliseOrders,
  normaliseProducts,
  parseToolResult,
} from "./adapter.js";

export interface McpAdapterOptions {
  command: string;
  args?: string[];
  email?: string;
  password?: string;
  dataDir: string;
  browserIdleSeconds?: number;
  logger: Logger;
  timeoutMs?: number;
}

/**
 * Drives the unofficial `continentept-mcp` server over stdio.
 *
 * The server owns the browser, the login session and the Continente-specific
 * selectors; this adapter only speaks its typed tool surface.
 */
export class McpContinente implements ContinenteAdapter {
  readonly name = "continente-mcp";
  private client: Client | null = null;
  private connecting: Promise<void> | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly options: McpAdapterOptions) {}

  private async connect(): Promise<void> {
    if (this.client) return;
    if (this.connecting) return this.connecting;

    this.connecting = (async () => {
      const env: Record<string, string> = {};
      for (const [key, value] of Object.entries(process.env)) {
        if (typeof value === "string") env[key] = value;
      }
      env.CONTINENTE_DATA_DIR = this.options.dataDir;
      env.CONTINENTE_UPDATE_CHECK = "0";
      env.CONTINENTE_BROWSER_IDLE_SECONDS = String(this.options.browserIdleSeconds ?? 120);
      if (this.options.email) env.CONTINENTE_EMAIL = this.options.email;
      if (this.options.password) env.CONTINENTE_PASSWORD = this.options.password;
      if (!env.HOME) env.HOME = this.options.dataDir;

      const transport = new StdioClientTransport({
        command: this.options.command,
        args: this.options.args ?? [],
        env,
        stderr: "inherit",
      });
      const client = new Client(
        { name: "bring2continente", version: "0.1.0" },
        { capabilities: {} },
      );
      await client.connect(transport);
      this.client = client;
      this.options.logger.info("continente-mcp connected");
    })();

    try {
      await this.connecting;
    } finally {
      this.connecting = null;
    }
  }

  /** Serialises tool calls: one browser action at a time, in order. */
  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private call<T = unknown>(name: string, args: Record<string, unknown>): Promise<T> {
    return this.enqueue(async () => {
      await this.connect();
      if (!this.client) throw new ContinenteError("MCP client not connected", "not_connected");
      const response = await this.client.callTool({ name, arguments: args }, undefined, {
        timeout: this.options.timeoutMs ?? 120_000,
      });
      return assertOk(parseToolResult(response)) as T;
    });
  }

  async search(query: string, limit: number): Promise<Product[]> {
    const data = await this.call("search_products", { query, limit });
    return normaliseProducts(data, "search");
  }

  async getProduct(productId: string): Promise<Product | null> {
    const data = await this.call("get_product", { productId });
    const products = normaliseProducts(data, "search");
    if (products[0]) return products[0];
    const rec = (data ?? {}) as Record<string, unknown>;
    return rec.productId ? (normaliseProducts([rec], "search")[0] ?? null) : null;
  }

  async getLabels(productIds: string[]): Promise<ProductLabels[]> {
    if (productIds.length === 0) return [];
    const data = await this.call<Record<string, unknown>>("get_product_labels", { productIds });
    const rec = (data ?? {}) as Record<string, unknown>;
    const raw = (rec.labels ?? rec.products ?? rec.items ?? data) as unknown;
    const arr = Array.isArray(raw) ? raw : [raw];
    return arr
      .map((entry) => normaliseLabels(entry))
      .map((label, index) => ({
        ...label,
        productId: label.productId || productIds[index] || "",
      }));
  }

  async getCart(): Promise<Cart> {
    const data = await this.call("get_cart", {});
    return normaliseCart(data);
  }

  async add(productId: string, quantity: number): Promise<Cart> {
    await this.call("add_cart_item", { productId, quantity });
    return this.getCart();
  }

  async setQuantity(productId: string, quantity: number): Promise<Cart> {
    if (quantity <= 0) return this.remove(productId);
    await this.call("set_cart_item_quantity", { productId, quantity });
    return this.getCart();
  }

  async remove(productId: string): Promise<Cart> {
    await this.call("remove_cart_item", { productId });
    return this.getCart();
  }

  async listOrders(limit: number): Promise<Order[]> {
    const data = await this.call("list_orders", { limit, includeLines: true });
    return normaliseOrders(data);
  }

  async frequentlyBought(limit: number): Promise<Product[]> {
    const data = await this.call("list_frequently_bought_products", {
      limit,
      orderLimit: 10,
    });
    return normaliseProducts(data, "history");
  }

  async sessionStatus(): Promise<{ authenticated: boolean; detail?: string }> {
    const data = await this.call<Record<string, unknown>>("get_session_status", {});
    const rec = (data ?? {}) as Record<string, unknown>;
    const auth = (rec.authentication ?? {}) as Record<string, unknown>;
    const state = String(auth.state ?? rec.state ?? "").toLowerCase();
    const authenticated =
      typeof rec.authenticated === "boolean"
        ? rec.authenticated
        : ["valid", "authenticated", "signed_in", "ok", "logged_in"].includes(state);
    return {
      authenticated,
      detail: state || (typeof rec.detail === "string" ? rec.detail : undefined),
    };
  }

  async close(): Promise<void> {
    if (this.client) {
      await this.client.close().catch(() => undefined);
      this.client = null;
    }
  }
}
