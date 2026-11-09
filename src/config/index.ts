import { z } from "zod";

const bool = (fallback: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v == null || v === "" ? fallback : /^(1|true|yes|on)$/i.test(v)));

const number = (fallback: number, min?: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v == null || v === "" ? fallback : Number(v)))
    .pipe(
      z
        .number()
        .finite()
        .min(min ?? Number.NEGATIVE_INFINITY),
    );

const list = (fallback: string[]) =>
  z
    .string()
    .optional()
    .transform((v) =>
      v == null || v.trim() === ""
        ? fallback
        : v
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
    );

const schema = z.object({
  NODE_ENV: z.string().default("development"),
  HOST: z.string().default("127.0.0.1"),
  PORT: number(8093, 0),
  DATA_DIR: z.string().default("./data"),
  DEMO: bool(false),
  DRY_RUN: bool(false),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),

  BRING_EMAIL: z.string().default(""),
  BRING_PASSWORD: z.string().default(""),
  BRING_LIST: z.string().default(""),
  BRING_COUNTRY: z.string().default("PT"),
  BRING_POLL_SECONDS: number(30, 10),

  CONTINENTE_EMAIL: z.string().default(""),
  CONTINENTE_PASSWORD: z.string().default(""),
  CONTINENTE_DATA_DIR: z.string().default(""),
  CONTINENTE_MCP_COMMAND: z.string().default(""),
  CONTINENTE_MCP_ARGS: z.string().default(""),
  CONTINENTE_BROWSER_IDLE_SECONDS: number(120, 0),
  CONTINENTE_CART_CHECK_SECONDS: number(300, 60),

  GLUTEN_MODE: z.enum(["strict", "standard", "off"]).default("strict"),
  EXCLUDED_CATEGORIES: list([
    "Supermercado/Talho",
    "Supermercado/Peixaria",
    "Supermercado/Frutas e Legumes",
  ]),
  NON_FOOD_PREFIXES: list([
    "Supermercado/Limpeza",
    "Supermercado/Higiene",
    "Supermercado/Animais",
    "Supermercado/Bebé",
    "Supermercado/Casa",
    "Supermercado/Têxtil",
    "Supermercado/Tecnologia",
    "Supermercado/Livraria",
  ]),

  AUTO_ADD_THRESHOLD: number(0.72, 0),
  AUTO_ADD_MARGIN: number(0.12, 0),
  MATCH_CANDIDATES: number(8, 2),

  LLM_PROVIDER: z.enum(["none", "opencode", "openai"]).default("none"),
  LLM_MODEL: z.string().default("opencode/deepseek-v4.1-flash"),
  LLM_BASE_URL: z.string().default(""),
  LLM_API_KEY: z.string().default(""),
  OPENCODE_COMMAND: z.string().default("opencode"),

  ON_COMPLETE: z.enum(["remove", "ignore"]).default("remove"),
  CHECKOUT_MODE: z.enum(["ask", "auto", "off"]).default("ask"),
  MAX_CART_EUR: number(200, 0),

  WEB_PASSWORD: z.string().default(""),
  SESSION_SECRET: z.string().default(""),
  SECURE_COOKIES: bool(false),

  NTFY_URL: z.string().default(""),
  NTFY_TOPIC: z.string().default("grocery"),
  NTFY_TOKEN: z.string().default(""),
  PUBLIC_URL: z.string().default(""),
});

export type AppConfig = {
  env: string;
  host: string;
  port: number;
  dataDir: string;
  demo: boolean;
  dryRun: boolean;
  logLevel: string;
  bring: {
    email: string;
    password: string;
    list: string;
    country: string;
    pollSeconds: number;
  };
  continente: {
    email: string;
    password: string;
    dataDir: string;
    mcpCommand: string;
    mcpArgs: string[];
    browserIdleSeconds: number;
    cartCheckSeconds: number;
  };
  policy: {
    glutenMode: "strict" | "standard" | "off";
    excludedCategories: string[];
    nonFoodPrefixes: string[];
  };
  matching: {
    autoThreshold: number;
    autoMargin: number;
    candidates: number;
    llm: {
      provider: "none" | "opencode" | "openai";
      model: string;
      baseUrl: string;
      apiKey: string;
      opencodeCommand: string;
    };
  };
  sync: {
    onComplete: "remove" | "ignore";
    checkoutMode: "ask" | "auto" | "off";
    maxCartEur: number;
  };
  web: {
    password: string;
    sessionSecret: string;
    secureCookies: boolean;
  };
  ntfy: { url: string; topic: string; token: string };
  publicUrl: string;
};

export function parseConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = schema.parse(env);
  const dataDir = parsed.DATA_DIR;
  const demo = parsed.DEMO;

  if (!demo) {
    if (!parsed.WEB_PASSWORD) {
      throw new Error("WEB_PASSWORD is required (or set DEMO=1 to try the UI without credentials)");
    }
    if (!parsed.SESSION_SECRET || parsed.SESSION_SECRET.length < 24) {
      throw new Error("SESSION_SECRET is required and must be at least 24 characters");
    }
    if (!parsed.BRING_EMAIL || !parsed.BRING_PASSWORD) {
      throw new Error("BRING_EMAIL and BRING_PASSWORD are required");
    }
    if (!parsed.BRING_LIST) {
      throw new Error("BRING_LIST is required (list name or list UUID)");
    }
  }

  return {
    env: parsed.NODE_ENV,
    host: parsed.HOST,
    port: parsed.PORT,
    dataDir,
    demo,
    dryRun: parsed.DRY_RUN,
    logLevel: parsed.LOG_LEVEL,
    bring: {
      email: parsed.BRING_EMAIL,
      password: parsed.BRING_PASSWORD,
      list: parsed.BRING_LIST,
      country: parsed.BRING_COUNTRY,
      pollSeconds: parsed.BRING_POLL_SECONDS,
    },
    continente: {
      email: parsed.CONTINENTE_EMAIL,
      password: parsed.CONTINENTE_PASSWORD,
      dataDir: parsed.CONTINENTE_DATA_DIR || `${dataDir}/continente`,
      mcpCommand: parsed.CONTINENTE_MCP_COMMAND || "node_modules/.bin/continentept-mcp",
      mcpArgs: parsed.CONTINENTE_MCP_ARGS ? parsed.CONTINENTE_MCP_ARGS.split(" ") : [],
      browserIdleSeconds: parsed.CONTINENTE_BROWSER_IDLE_SECONDS,
      cartCheckSeconds: parsed.CONTINENTE_CART_CHECK_SECONDS,
    },
    policy: {
      glutenMode: parsed.GLUTEN_MODE,
      excludedCategories: parsed.EXCLUDED_CATEGORIES,
      nonFoodPrefixes: parsed.NON_FOOD_PREFIXES,
    },
    matching: {
      autoThreshold: parsed.AUTO_ADD_THRESHOLD,
      autoMargin: parsed.AUTO_ADD_MARGIN,
      candidates: parsed.MATCH_CANDIDATES,
      llm: {
        provider: parsed.LLM_PROVIDER,
        model: parsed.LLM_MODEL,
        baseUrl: parsed.LLM_BASE_URL,
        apiKey: parsed.LLM_API_KEY,
        opencodeCommand: parsed.OPENCODE_COMMAND,
      },
    },
    sync: {
      onComplete: parsed.ON_COMPLETE,
      checkoutMode: parsed.CHECKOUT_MODE,
      maxCartEur: parsed.MAX_CART_EUR,
    },
    web: {
      password: demo ? parsed.WEB_PASSWORD || "demo" : parsed.WEB_PASSWORD,
      sessionSecret:
        parsed.SESSION_SECRET || (demo ? "demo-session-secret-not-for-production" : ""),
      secureCookies: parsed.SECURE_COOKIES,
    },
    ntfy: { url: parsed.NTFY_URL, topic: parsed.NTFY_TOPIC, token: parsed.NTFY_TOKEN },
    publicUrl: parsed.PUBLIC_URL,
  };
}
