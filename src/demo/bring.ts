import { randomUUID } from "node:crypto";
import type { BringProvider } from "../bring/provider.js";
import type { BringItem, BringList, BringSnapshot } from "../types.js";

const LIST: BringList = { listUuid: "demo-list", name: "Compras" };

const SEED: Array<[string, string]> = [
  ["Leite", "2"],
  ["Pão de forma", ""],
  ["Peito de frango", ""],
  ["Banana", ""],
  ["Bolachas", ""],
  ["Queijo flamengo", ""],
  ["Atum", "3"],
  ["Detergente", ""],
];

export class DemoBring implements BringProvider {
  private purchase: BringItem[] = SEED.map(([itemId, specification]) => ({
    uuid: randomUUID(),
    itemId,
    specification,
  }));
  private recently: BringItem[] = [];

  async resolveList(selector: string): Promise<BringList> {
    const wanted = selector.trim().toLowerCase();
    if (wanted === LIST.listUuid || wanted === LIST.name.toLowerCase() || wanted === "")
      return LIST;
    throw new Error(`Demo list ${JSON.stringify(selector)} not found`);
  }

  async getList(): Promise<BringSnapshot> {
    return {
      listUuid: LIST.listUuid,
      listName: LIST.name,
      purchase: this.purchase.map((i) => ({ ...i })),
      recently: this.recently.map((i) => ({ ...i })),
    };
  }

  async complete(_listUuid: string, items: BringItem[]): Promise<void> {
    const ids = new Set(items.map((i) => i.uuid));
    for (const item of this.purchase.filter((i) => ids.has(i.uuid))) {
      this.recently.push(item);
    }
    this.purchase = this.purchase.filter((i) => !ids.has(i.uuid));
  }

  async remove(_listUuid: string, items: BringItem[]): Promise<void> {
    const ids = new Set(items.map((i) => i.uuid));
    this.purchase = this.purchase.filter((i) => !ids.has(i.uuid));
  }

  add(itemId: string, specification = ""): BringItem {
    const item = { uuid: randomUUID(), itemId, specification };
    this.purchase.push(item);
    return item;
  }
}
