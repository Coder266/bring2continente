import { describe, expect, it, vi } from "vitest";
import { BringClient } from "../src/bring/client.js";

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

describe("Bring client", () => {
  it("logs in, reads a list and reuses the ETag", async () => {
    let listCalls = 0;
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/bringauth")) {
        return json({
          uuid: "user-1",
          access_token: "token",
          refresh_token: "refresh",
          expires_in: 3600,
        });
      }
      if (url.endsWith("/bringusers/user-1/lists")) {
        return json({ lists: [{ listUuid: "list-1", name: "Compras" }] });
      }
      if (url.endsWith("/bringusers/user-1/lists/list-1")) {
        listCalls += 1;
        const headers = (init?.headers ?? {}) as Record<string, string>;
        if (headers["If-None-Match"] === "etag-1") {
          return new Response(null, { status: 304 });
        }
        return json(
          {
            uuid: "list-1",
            status: "SHARED",
            items: {
              purchase: [{ uuid: "item-1", itemId: "Leite", specification: "2" }],
              recently: [{ uuid: "item-2", itemId: "Pão", specification: "" }],
            },
          },
          { headers: { ETag: "etag-1" } },
        );
      }
      throw new Error(`unexpected ${url}`);
    }) as unknown as typeof fetch;

    const client = new BringClient({
      email: "a@b.c",
      password: "secret",
      fetchImpl,
    });
    const list = await client.resolveList("Compras");
    expect(list.listUuid).toBe("list-1");

    const first = await client.getList(list);
    expect(first.purchase).toHaveLength(1);
    expect(first.recently).toHaveLength(1);

    const second = await client.getList(list);
    expect(second.notModified).toBe(true);
    expect(listCalls).toBe(2);
  });

  it("sends TO_RECENTLY when checking items off", async () => {
    let body: unknown;
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/bringauth")) {
        return json({
          uuid: "user-1",
          access_token: "token",
          refresh_token: "refresh",
          expires_in: 3600,
        });
      }
      if (url.endsWith("/bringusers/user-1/lists")) {
        return json({ lists: [{ listUuid: "list-1", name: "Compras" }] });
      }
      if (url.endsWith("/bringlists/list-1/items")) {
        body = JSON.parse(String(init?.body));
        return new Response("", { status: 200 });
      }
      throw new Error(`unexpected ${url}`);
    }) as unknown as typeof fetch;

    const client = new BringClient({ email: "a@b.c", password: "secret", fetchImpl });
    const list = await client.resolveList("Compras");
    await client.complete(list.listUuid, [{ uuid: "item-1", itemId: "Leite", specification: "2" }]);
    expect(body).toMatchObject({
      changes: [{ itemId: "Leite", uuid: "item-1", operation: "TO_RECENTLY" }],
    });
  });
});
