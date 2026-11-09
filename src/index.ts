import { mkdirSync } from "node:fs";
import { BringClient } from "./bring/client.js";
import { parseConfig } from "./config/index.js";
import type { ContinenteAdapter } from "./continente/adapter.js";
import { McpContinente } from "./continente/mcp.js";
import { DemoBring } from "./demo/bring.js";
import { DemoContinente } from "./demo/continente.js";
import { consoleLogger } from "./logger.js";
import { createPicker } from "./matcher/picker.js";
import { Resolver } from "./matcher/resolver.js";
import { NoopNotifier, NtfyNotifier } from "./notify.js";
import { PolicyEngine } from "./policy/engine.js";
import { ProductFactsService } from "./policy/facts.js";
import { Store } from "./store/index.js";
import { SyncEngine } from "./sync/engine.js";
import { createApp } from "./web/app.js";

async function main(): Promise<void> {
  const config = parseConfig();
  mkdirSync(config.dataDir, { recursive: true });
  const logger = consoleLogger(config.logLevel);
  const store = new Store(`${config.dataDir}/state.db`);

  const demoContinente = config.demo ? new DemoContinente() : null;
  const demoBring = config.demo ? new DemoBring() : null;

  const adapter: ContinenteAdapter =
    demoContinente ??
    new McpContinente({
      command: config.continente.mcpCommand,
      args: config.continente.mcpArgs,
      email: config.continente.email,
      password: config.continente.password,
      dataDir: config.continente.dataDir,
      browserIdleSeconds: config.continente.browserIdleSeconds,
      logger,
    });

  const policy = new PolicyEngine({
    glutenMode: config.policy.glutenMode,
    excludedCategories: config.policy.excludedCategories,
    nonFoodPrefixes: config.policy.nonFoodPrefixes,
    isUserVerified: (productId) => store.isVerified(productId),
  });

  const facts = new ProductFactsService({
    labels: (ids) => adapter.getLabels(ids),
    logger,
    cache: store,
    ...(demoContinente
      ? {
          fetchImpl: (async (input: string | URL | Request) => {
            const url = String(input);
            const id = url.match(/demo-(\d+)\.html/)?.[1] ?? "";
            const glutenFree = demoContinente.isGlutenFree(id);
            return new Response(
              glutenFree
                ? '<html><img src="/badges/general/col/sem_gluten.png" alt="Sem Glúten"></html>'
                : "<html><body>no badge</body></html>",
              { status: 200, headers: { "Content-Type": "text/html" } },
            );
          }) as typeof fetch,
        }
      : {}),
  });

  const picker = createPicker({
    provider: config.matching.llm.provider,
    model: config.matching.llm.model,
    baseUrl: config.matching.llm.baseUrl,
    apiKey: config.matching.llm.apiKey,
    opencodeCommand: config.matching.llm.opencodeCommand,
    logger,
  });

  const resolver = new Resolver({
    adapter,
    facts,
    policy,
    store,
    picker,
    logger,
    options: {
      autoThreshold: config.matching.autoThreshold,
      autoMargin: config.matching.autoMargin,
      maxCandidates: config.matching.candidates,
      glutenMode: config.policy.glutenMode,
    },
  });

  const notifier =
    demoContinente || !config.ntfy.url
      ? new NoopNotifier()
      : new NtfyNotifier({
          url: config.ntfy.url,
          topic: config.ntfy.topic,
          token: config.ntfy.token,
          publicUrl: config.publicUrl,
          logger,
        });

  const bring =
    demoBring ??
    new BringClient({
      email: config.bring.email,
      password: config.bring.password,
      country: config.bring.country,
    });

  const engine = new SyncEngine({
    config,
    bring,
    adapter,
    resolver,
    policy,
    facts,
    store,
    notifier,
    logger,
  });

  const app = createApp({
    config,
    store,
    engine,
    adapter,
    policy,
    facts,
    logger,
    ...(demoBring && demoContinente
      ? { demo: { bring: demoBring, continente: demoContinente } }
      : {}),
  });

  engine.start();
  await app.listen({ host: config.host, port: config.port });
  logger.info(
    `bring2continente listening on http://${config.host}:${config.port}${config.demo ? " (demo)" : ""}`,
  );

  const shutdown = async () => {
    engine.stop();
    await app.close().catch(() => undefined);
    await adapter.close().catch(() => undefined);
    store.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
