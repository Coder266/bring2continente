import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import type { AppConfig } from "../config/index.js";
import type { ContinenteAdapter } from "../continente/adapter.js";
import type { DemoBring } from "../demo/bring.js";
import type { DemoContinente } from "../demo/continente.js";
import type { Logger } from "../logger.js";
import type { PolicyEngine } from "../policy/engine.js";
import type { ProductFactsService } from "../policy/facts.js";
import type { Store } from "../store/index.js";
import type { SyncEngine } from "../sync/engine.js";

const COOKIE = "b2c_session";
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;

export interface AppDeps {
  config: AppConfig;
  store: Store;
  engine: SyncEngine;
  adapter: ContinenteAdapter;
  policy: PolicyEngine;
  facts: ProductFactsService;
  logger: Logger;
  demo?: { bring: DemoBring; continente: DemoContinente };
}

export function createApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({
    logger: deps.config.env === "test" ? false : { level: deps.config.logLevel },
    trustProxy: true,
  });

  const attempts = new Map<string, { count: number; resetAt: number }>();

  const sign = (expires: number): string =>
    createHmac("sha256", deps.config.web.sessionSecret).update(String(expires)).digest("hex");

  const cookieValue = (): string => {
    const expires = Date.now() + SESSION_MS;
    return `${expires}.${sign(expires)}`;
  };

  const isAuthenticated = (req: FastifyRequest): boolean => {
    if (deps.config.demo && !deps.config.web.password) return true;
    const raw = req.headers.cookie ?? "";
    const value = raw
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${COOKIE}=`))
      ?.slice(COOKIE.length + 1);
    if (!value) return false;
    const [expiresRaw, signature] = value.split(".");
    const expires = Number(expiresRaw);
    if (!Number.isFinite(expires) || expires < Date.now() || !signature) return false;
    const expected = sign(expires);
    if (signature.length !== expected.length) return false;
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  };

  const requireAuth = async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.url.startsWith("/api/")) return;
    if (req.url === "/api/login" || req.url === "/api/health") return;
    if (!isAuthenticated(req)) return reply.code(401).send({ error: "unauthorized" });
  };
  app.addHook("onRequest", requireAuth);

  // ---- auth --------------------------------------------------------------

  app.post("/api/login", async (req, reply) => {
    const ip = req.ip;
    const now = Date.now();
    const entry = attempts.get(ip) ?? { count: 0, resetAt: now + 60_000 };
    if (entry.resetAt < now) {
      entry.count = 0;
      entry.resetAt = now + 60_000;
    }
    entry.count += 1;
    attempts.set(ip, entry);
    if (entry.count > 10) return reply.code(429).send({ error: "too many attempts" });

    const password = String((req.body as { password?: string } | null)?.password ?? "");
    const expected = deps.config.web.password;
    const a = createHash("sha256").update(password).digest();
    const b = createHash("sha256").update(expected).digest();
    if (!expected || !timingSafeEqual(a, b)) {
      return reply.code(401).send({ error: "invalid password" });
    }
    const secure = deps.config.web.secureCookies ? "; Secure" : "";
    reply.header(
      "Set-Cookie",
      `${COOKIE}=${cookieValue()}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MS / 1000}${secure}`,
    );
    return { ok: true };
  });

  app.post("/api/logout", async (_req, reply) => {
    reply.header("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; Max-Age=0`);
    return { ok: true };
  });

  app.get("/api/session", async (req) => ({
    authenticated: isAuthenticated(req),
    demo: deps.config.demo,
  }));

  // ---- status / items ----------------------------------------------------

  app.get("/api/health", async () => ({ ok: true }));

  app.get("/api/status", async () => deps.engine.status());

  app.get("/api/items", async () => {
    const items = deps.engine.listItems();
    return {
      items: items.map((item) => {
        const mapping = item.mappingId ? deps.store.getMapping(item.mappingId) : null;
        return {
          ...item,
          mapping,
        };
      }),
    };
  });

  app.get("/api/items/:uuid/candidates", async (req, reply) => {
    const { uuid } = req.params as { uuid: string };
    try {
      return await deps.engine.candidates(uuid);
    } catch (error) {
      return reply.code(404).send({ error: String(error) });
    }
  });

  app.post("/api/items/:uuid/pick", async (req, reply) => {
    const { uuid } = req.params as { uuid: string };
    const productId = String((req.body as { productId?: string } | null)?.productId ?? "");
    if (!productId) return reply.code(400).send({ error: "productId is required" });
    try {
      return await deps.engine.pick(uuid, productId);
    } catch (error) {
      return reply.code(400).send({ error: String(error) });
    }
  });

  app.post("/api/items/:uuid/verify", async (req, reply) => {
    const { uuid } = req.params as { uuid: string };
    const productId = String((req.body as { productId?: string } | null)?.productId ?? "");
    if (!productId) return reply.code(400).send({ error: "productId is required" });
    const product = await deps.adapter.getProduct(productId);
    if (!product) return reply.code(404).send({ error: "product not found" });
    deps.store.verifyProduct(product, "Confirmed by the user from the review queue");
    try {
      return await deps.engine.pick(uuid, productId);
    } catch (error) {
      return reply.code(400).send({ error: String(error) });
    }
  });

  app.post("/api/items/:uuid/ignore", async (req) => {
    const { uuid } = req.params as { uuid: string };
    await deps.engine.ignore(uuid);
    return { ok: true };
  });

  app.post("/api/items/:uuid/retry", async (req, reply) => {
    const { uuid } = req.params as { uuid: string };
    try {
      await deps.engine.retry(uuid);
      return { ok: true };
    } catch (error) {
      return reply.code(400).send({ error: String(error) });
    }
  });

  // ---- mappings ----------------------------------------------------------

  app.get("/api/mappings", async () => ({ mappings: deps.store.listMappings() }));

  app.get("/api/mappings/:id/candidates", async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    try {
      return await deps.engine.mappingCandidates(id);
    } catch (error) {
      return reply.code(404).send({ error: String(error) });
    }
  });

  app.patch("/api/mappings/:id", async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const body = (req.body ?? {}) as { productId?: string; multiplier?: number; verify?: boolean };
    const mapping = deps.store.getMapping(id);
    if (!mapping) return reply.code(404).send({ error: "mapping not found" });

    if (body.productId) {
      const product = await deps.adapter.getProduct(body.productId);
      if (!product) return reply.code(404).send({ error: "product not found" });
      const facts = await deps.facts.get(product);
      const decision = deps.policy.evaluate(product, facts);
      if (!decision.allow) return reply.code(400).send({ error: decision.reason });
      if (body.verify) deps.store.verifyProduct(product, "Confirmed by the user");
      return deps.engine.swapMapping(id, product);
    }
    if (body.multiplier != null) {
      return deps.store.updateMapping(id, { multiplier: Math.max(1, Number(body.multiplier)) });
    }
    return mapping;
  });

  app.delete("/api/mappings/:id", async (req) => {
    deps.store.deleteMapping(Number((req.params as { id: string }).id));
    return { ok: true };
  });

  // ---- cart / actions ----------------------------------------------------

  app.get("/api/cart", async () => {
    try {
      return await deps.adapter.getCart();
    } catch (error) {
      return { error: String(error), items: [], totals: {} };
    }
  });

  app.post("/api/actions/sync", async () => {
    await deps.engine.pollNow();
    return deps.engine.status();
  });

  app.post("/api/actions/check-cart", async () => {
    await deps.engine.checkCart();
    return deps.engine.status();
  });

  app.post("/api/actions/pause", async () => {
    await deps.engine.pause();
    return deps.engine.status();
  });

  app.post("/api/actions/resume", async () => {
    await deps.engine.resume();
    return deps.engine.status();
  });

  app.post("/api/actions/reconcile", async (req, reply) => {
    const confirm = Boolean((req.body as { confirm?: boolean } | null)?.confirm);
    if (!confirm) return reply.code(400).send({ error: "confirm: true is required" });
    await deps.engine.reconcile();
    return deps.engine.status();
  });

  // ---- checkout ----------------------------------------------------------

  app.get("/api/checkout", async () => ({ pending: deps.store.pendingCheckouts() }));

  app.post("/api/checkout/:id/confirm", async (req) => {
    const count = await deps.engine.completeCheckout(Number((req.params as { id: string }).id));
    return { ok: true, completed: count };
  });

  app.post("/api/checkout/:id/dismiss", async (req) => {
    deps.engine.dismissCheckout(Number((req.params as { id: string }).id));
    return { ok: true };
  });

  // ---- events / rules ----------------------------------------------------

  app.get("/api/events", async (req) => {
    const limit = Number((req.query as { limit?: string }).limit ?? 100);
    return { events: deps.store.listEvents(Math.min(500, Math.max(1, limit))) };
  });

  app.get("/api/rules", async () => ({
    glutenMode: deps.config.policy.glutenMode,
    excludedCategories: deps.config.policy.excludedCategories,
    nonFoodPrefixes: deps.config.policy.nonFoodPrefixes,
    verifiedProducts: deps.store.listVerified(),
    llm: deps.config.matching.llm.provider,
    autoThreshold: deps.config.matching.autoThreshold,
    autoMargin: deps.config.matching.autoMargin,
  }));

  // ---- demo helpers ------------------------------------------------------

  if (deps.demo) {
    const demo = deps.demo;
    app.post("/api/demo/items", async (req) => {
      const body = (req.body ?? {}) as { name?: string; specification?: string };
      const item = demo.bring.add(String(body.name ?? ""), String(body.specification ?? ""));
      await deps.engine.pollNow();
      return item;
    });
    app.post("/api/demo/order", async () => {
      const order = demo.continente.placeOrder();
      await deps.engine.checkCart();
      return order;
    });
  }

  // ---- static UI ---------------------------------------------------------

  const webRoot = resolve(process.env.UI_DIR ?? resolve(process.cwd(), "dist/web"));
  if (existsSync(webRoot)) {
    app.register(fastifyStatic, { root: webRoot });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api/")) return reply.code(404).send({ error: "not found" });
      return reply.sendFile("index.html");
    });
  } else {
    app.get("/", async () => ({
      service: "bring2continente",
      hint: "Run `npm run build:web` or use the Vite dev server on http://localhost:5173",
    }));
  }

  return app;
}
