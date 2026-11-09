import { spawn } from "node:child_process";
import type { Logger } from "../logger.js";
import type { BringItem } from "../types.js";
import type { ScoredCandidate } from "./score.js";

export interface PickResult {
  productId: string | null;
  confidence: number;
  reason: string;
  source: "llm";
}

export interface ProductPicker {
  pick(item: BringItem, candidates: ScoredCandidate[]): Promise<PickResult | null>;
}

export interface LlmOptions {
  provider: "none" | "opencode" | "openai";
  model: string;
  baseUrl?: string;
  apiKey?: string;
  opencodeCommand: string;
  logger: Logger;
  timeoutMs?: number;
}

export function createPicker(options: LlmOptions): ProductPicker | null {
  if (options.provider === "none") return null;
  if (options.provider === "opencode") return new OpencodePicker(options);
  return new OpenAiPicker(options);
}

function promptFor(item: BringItem, candidates: ScoredCandidate[]): string {
  const list = candidates
    .map(({ product, score }) => {
      const bits = [
        `id=${product.id}`,
        product.name,
        product.brand ? `brand=${product.brand}` : null,
        product.packageText ? `package=${product.packageText}` : null,
        product.category ? `category=${product.category}` : null,
        product.price != null ? `price=EUR ${product.price.toFixed(2)}` : null,
        `match=${score.toFixed(2)}`,
      ].filter(Boolean);
      return `- ${bits.join(" | ")}`;
    })
    .join("\n");

  return [
    "You match one Portuguese shopping-list item to one supermarket product.",
    "Every candidate below already passed a strict gluten-free safety filter.",
    "",
    `Item: ${JSON.stringify(item.itemId)}`,
    `Specification: ${JSON.stringify(item.specification || "")}`,
    "",
    "Candidates:",
    list,
    "",
    "Rules:",
    "- Choose only from the candidate ids above. Never invent an id.",
    "- Prefer the plain/basic product when the list does not ask for a flavour or variant.",
    "- Respect the specification when it names a quantity, size or brand.",
    "- If no candidate really fits, answer null.",
    "",
    'Return only JSON: {"productId": string|null, "confidence": number, "reason": string}',
  ].join("\n");
}

function extractJsonObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1)) as Record<string, unknown>;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

export function parsePick(text: string, candidateIds: Set<string>): PickResult | null {
  const objects: Record<string, unknown>[] = [];
  // `opencode run --format json` emits one event object per line; the model's
  // answer is in `part.text`, so unwrap that as well.
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      objects.push(JSON.parse(trimmed) as Record<string, unknown>);
    } catch {
      // not a JSON line
    }
  }
  const direct = extractJsonObject(text);
  if (direct) objects.push(direct);

  const answers: Record<string, unknown>[] = [];
  for (const obj of objects) {
    const part = obj.part as Record<string, unknown> | undefined;
    const nested = typeof part?.text === "string" ? extractJsonObject(part.text) : null;
    if (nested) answers.push(nested);
    if (typeof obj.text === "string") {
      const fromText = extractJsonObject(obj.text);
      if (fromText) answers.push(fromText);
    }
  }

  for (const obj of [...objects.reverse(), ...answers.reverse()]) {
    const id = obj.productId;
    if (id === null) {
      return {
        productId: null,
        confidence: 0,
        reason: String(obj.reason ?? "no match"),
        source: "llm",
      };
    }
    if (typeof id === "string" && candidateIds.has(id)) {
      const confidence = Number(obj.confidence);
      return {
        productId: id,
        confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0.5,
        reason: String(obj.reason ?? "picked by the model"),
        source: "llm",
      };
    }
  }
  return null;
}

export class OpencodePicker implements ProductPicker {
  constructor(private readonly options: LlmOptions) {}

  async pick(item: BringItem, candidates: ScoredCandidate[]): Promise<PickResult | null> {
    if (candidates.length === 0) return null;
    const prompt = promptFor(item, candidates);
    const args = ["run", "--format", "json", "--model", this.options.model, prompt];
    const stdout = await runProcess(
      this.options.opencodeCommand,
      args,
      this.options.timeoutMs ?? 90_000,
    ).catch((error) => {
      this.options.logger.warn("opencode picker failed", { error: String(error) });
      return "";
    });
    if (!stdout) return null;
    return parsePick(stdout, new Set(candidates.map((c) => c.product.id)));
  }
}

export class OpenAiPicker implements ProductPicker {
  constructor(private readonly options: LlmOptions) {}

  async pick(item: BringItem, candidates: ScoredCandidate[]): Promise<PickResult | null> {
    if (candidates.length === 0) return null;
    const base = (this.options.baseUrl ?? "").replace(/\/$/, "");
    if (!base) {
      this.options.logger.warn("LLM_BASE_URL is not set; skipping the model picker");
      return null;
    }
    const url = base.endsWith("/chat/completions") ? base : `${base}/chat/completions`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(this.options.apiKey ? { Authorization: `Bearer ${this.options.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: this.options.model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You are a precise product matcher. Answer with JSON only and never invent product ids.",
          },
          { role: "user", content: promptFor(item, candidates) },
        ],
      }),
      signal: AbortSignal.timeout(this.options.timeoutMs ?? 60_000),
    }).catch((error) => {
      this.options.logger.warn("LLM request failed", { error: String(error) });
      return null;
    });
    if (!response?.ok) return null;
    const body = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = body.choices?.[0]?.message?.content ?? "";
    return parsePick(text, new Set(candidates.map((c) => c.product.id)));
  }
}

function runProcess(command: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`Model process timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(`Model process exited with ${code}: ${stderr.slice(0, 500)}`));
    });
  });
}
