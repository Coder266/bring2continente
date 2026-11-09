import type { BringItem, BringList, BringSnapshot } from "../types.js";

/** The slice of the Bring! API the sync engine needs; a demo provider implements it too. */
export interface BringProvider {
  resolveList(selector: string): Promise<BringList>;
  getList(list: BringList): Promise<BringSnapshot>;
  complete(listUuid: string, items: BringItem[]): Promise<void>;
  remove(listUuid: string, items: BringItem[]): Promise<void>;
}
