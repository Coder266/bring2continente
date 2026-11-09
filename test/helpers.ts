import { vi } from "vitest";
import { parseConfig } from "../src/config/index.js";
import { DemoBring } from "../src/demo/bring.js";
import { DemoContinente } from "../src/demo/continente.js";
import { silentLogger } from "../src/logger.js";
import { Resolver } from "../src/matcher/resolver.js";
import { NoopNotifier } from "../src/notify.js";
import { PolicyEngine } from "../src/policy/engine.js";
import { ProductFactsService } from "../src/policy/facts.js";
import { Store } from "../src/store/index.js";
import { SyncEngine } from "../src/sync/engine.js";

export function makeDemoStack(env: Record<string, string> = {}) {
  const config = parseConfig({ DEMO: "1", ...env });
  const store = new Store(":memory:");
  const bring = new DemoBring();
  const adapter = new DemoContinente();
  const policy = new PolicyEngine({
    glutenMode: config.policy.glutenMode,
    excludedCategories: config.policy.excludedCategories,
    nonFoodPrefixes: config.policy.nonFoodPrefixes,
    isUserVerified: (id) => store.isVerified(id),
  });

  const fetchImpl = vi.fn(async (input: string | URL | Request) => {
    const id = String(input).match(/demo-(\d+)\.html/)?.[1] ?? "";
    return new Response(
      adapter.isGlutenFree(id)
        ? '<html><img src="/badges/sem_gluten.png" alt="Sem Glúten"></html>'
        : "<html><body>no badge</body></html>",
      { status: 200 },
    );
  }) as unknown as typeof fetch;

  const facts = new ProductFactsService({
    labels: (ids) => adapter.getLabels(ids),
    logger: silentLogger,
    cache: store,
    fetchImpl,
  });

  const resolver = new Resolver({
    adapter,
    facts,
    policy,
    store,
    picker: null,
    logger: silentLogger,
    options: {
      autoThreshold: config.matching.autoThreshold,
      autoMargin: config.matching.autoMargin,
      maxCandidates: config.matching.candidates,
      glutenMode: config.policy.glutenMode,
    },
  });

  const engine = new SyncEngine({
    config,
    bring,
    adapter,
    resolver,
    policy,
    facts,
    store,
    notifier: new NoopNotifier(),
    logger: silentLogger,
  });

  return { config, store, bring, adapter, policy, facts, resolver, engine };
}
