import { z } from "zod";
import type { BringItem, BringList, BringSnapshot } from "../types.js";

const BASE_URL = "https://api.getbring.com/rest/v2";

/** Headers used by the Bring! Android client. The API key is the published client key. */
const BASE_HEADERS: Record<string, string> = {
  "X-BRING-API-KEY": "cof4Nc6D8saplXjE3h3HXqHH8m7VU2i1Gs0g85Sp",
  "X-BRING-CLIENT": "android",
  "X-BRING-APPLICATION": "bring",
  "X-BRING-COUNTRY": "PT",
};

const authSchema = z.object({
  uuid: z.string(),
  publicUuid: z.string().optional(),
  name: z.string().optional(),
  access_token: z.string(),
  refresh_token: z.string().optional(),
  expires_in: z.number().optional(),
  error: z.string().optional(),
  message: z.string().optional(),
});

const itemSchema = z.object({
  uuid: z.string(),
  itemId: z.string(),
  specification: z.string().nullish(),
});

const listSchema = z.object({
  lists: z.array(
    z.object({
      listUuid: z.string(),
      name: z.string(),
      theme: z.string().optional(),
    }),
  ),
});

const itemsSchema = z.object({
  uuid: z.string().optional(),
  status: z.string().optional(),
  items: z
    .object({
      purchase: z.array(itemSchema).default([]),
      recently: z.array(itemSchema).default([]),
    })
    .default({ purchase: [], recently: [] }),
});

export type BringOperation = "TO_PURCHASE" | "TO_RECENTLY" | "REMOVE";

export interface BringChange {
  itemId: string;
  uuid?: string;
  specification?: string;
  operation?: BringOperation;
}

export interface BringClientOptions {
  email: string;
  password: string;
  country?: string;
  fetchImpl?: typeof fetch;
}

export class BringError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "BringError";
  }
}

export class BringClient {
  private readonly fetchImpl: typeof fetch;
  private accessToken = "";
  private refreshToken = "";
  private userUuid = "";
  private expiresAt = 0;
  private headers: Record<string, string>;
  private readonly cache = new Map<string, { etag: string; snapshot: BringSnapshot }>();

  constructor(private readonly options: BringClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.headers = { ...BASE_HEADERS };
    if (options.country) this.headers["X-BRING-COUNTRY"] = options.country.toUpperCase();
  }

  get loggedIn(): boolean {
    return Boolean(this.accessToken && this.userUuid);
  }

  async login(): Promise<void> {
    const res = await this.fetchImpl(`${BASE_URL}/bringauth`, {
      method: "POST",
      headers: {
        ...this.headers,
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      },
      body: new URLSearchParams({
        email: this.options.email,
        password: this.options.password,
      }).toString(),
    });
    const body = authSchema.parse(await res.json());
    if (!res.ok || body.error) {
      throw new BringError(body.message ?? body.error ?? `Bring login failed (${res.status})`);
    }
    this.applyTokens(body);
  }

  private applyTokens(body: z.infer<typeof authSchema>): void {
    this.accessToken = body.access_token;
    this.refreshToken = body.refresh_token ?? this.refreshToken;
    this.userUuid = body.uuid;
    this.expiresAt = Date.now() + Math.max(60, (body.expires_in ?? 3600) - 90) * 1000;
    this.headers = {
      ...this.headers,
      Authorization: `Bearer ${this.accessToken}`,
      "X-BRING-USER-UUID": this.userUuid,
    };
  }

  private async refresh(): Promise<void> {
    if (!this.refreshToken) throw new BringError("No refresh token; login required");
    const res = await this.fetchImpl(`${BASE_URL}/bringauth/token`, {
      method: "POST",
      headers: {
        ...BASE_HEADERS,
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: this.refreshToken,
      }).toString(),
    });
    const body = authSchema.parse(await res.json());
    if (!res.ok) throw new BringError(body.message ?? `Bring token refresh failed (${res.status})`);
    this.applyTokens(body);
  }

  private async request(path: string, init: RequestInit = {}, retry = true): Promise<Response> {
    if (!this.loggedIn) await this.login();
    else if (Date.now() > this.expiresAt) await this.refresh();

    const res = await this.fetchImpl(`${BASE_URL}${path}`, {
      ...init,
      headers: { ...this.headers, ...(init.headers as Record<string, string> | undefined) },
    });

    if (res.status === 401 && retry) {
      await this.refresh();
      return this.request(path, init, false);
    }
    return res;
  }

  private async ensureAuth(): Promise<void> {
    if (!this.loggedIn) await this.login();
    else if (Date.now() > this.expiresAt) await this.refresh();
  }

  async loadLists(): Promise<BringList[]> {
    await this.ensureAuth();
    const res = await this.request(`/bringusers/${this.userUuid}/lists`);
    if (!res.ok) throw new BringError(`Cannot load Bring lists (${res.status})`, res.status);
    return listSchema.parse(await res.json()).lists;
  }

  async resolveList(selector: string): Promise<BringList> {
    const lists = await this.loadLists();
    const wanted = selector.trim().toLowerCase();
    const found = lists.find(
      (l) => l.listUuid === selector || l.name.trim().toLowerCase() === wanted,
    );
    if (!found) {
      throw new BringError(
        `Bring list ${JSON.stringify(selector)} not found (available: ${lists
          .map((l) => l.name)
          .join(", ")})`,
      );
    }
    return found;
  }

  /** Reads a list with ETag caching; a 304 returns the cached snapshot. */
  async getList(list: BringList): Promise<BringSnapshot> {
    await this.ensureAuth();
    const cached = this.cache.get(list.listUuid);
    const headers: Record<string, string> = {};
    if (cached?.etag) headers["If-None-Match"] = cached.etag;

    const res = await this.request(`/bringusers/${this.userUuid}/lists/${list.listUuid}`, {
      headers,
    });

    if (res.status === 304 && cached) {
      return { ...cached.snapshot, notModified: true };
    }
    if (!res.ok) throw new BringError(`Cannot read Bring list (${res.status})`, res.status);

    const body = itemsSchema.parse(await res.json());
    const snapshot: BringSnapshot = {
      listUuid: list.listUuid,
      listName: list.name,
      purchase: body.items.purchase.map(toItem),
      recently: body.items.recently.map(toItem),
    };
    const etag = res.headers.get("etag");
    if (etag) this.cache.set(list.listUuid, { etag, snapshot });
    return snapshot;
  }

  async batch(listUuid: string, changes: BringChange[], operation: BringOperation): Promise<void> {
    if (changes.length === 0) return;
    await this.ensureAuth();
    const res = await this.request(`/bringlists/${listUuid}/items`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        changes: changes.map((c) => ({
          accuracy: 0,
          altitude: 0,
          latitude: 0,
          longitude: 0,
          ...c,
          operation: c.operation ?? operation,
        })),
        sender: "",
      }),
    });
    if (!res.ok) throw new BringError(`Bring batch update failed (${res.status})`, res.status);
  }

  complete(listUuid: string, items: BringItem[]): Promise<void> {
    return this.batch(
      listUuid,
      items.map((i) => ({ itemId: i.itemId, uuid: i.uuid, specification: i.specification })),
      "TO_RECENTLY",
    );
  }

  remove(listUuid: string, items: BringItem[]): Promise<void> {
    return this.batch(
      listUuid,
      items.map((i) => ({ itemId: i.itemId, uuid: i.uuid, specification: i.specification })),
      "REMOVE",
    );
  }
}

function toItem(raw: z.infer<typeof itemSchema>): BringItem {
  return {
    uuid: raw.uuid,
    itemId: raw.itemId,
    specification: raw.specification ?? "",
  };
}
