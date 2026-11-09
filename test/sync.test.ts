import { describe, expect, it } from "vitest";
import { makeDemoStack } from "./helpers.js";

const cartNames = async (stack: ReturnType<typeof makeDemoStack>) =>
  (await stack.adapter.getCart()).items.map((line) => line.name);

describe("sync engine", () => {
  it("fills the cart but never adds meat, fish or fresh produce", async () => {
    const stack = makeDemoStack();
    await stack.engine.pollNow();
    const names = await cartNames(stack);

    expect(names.some((n) => n.includes("Leite Meio Gordo"))).toBe(true);
    expect(names.some((n) => n.includes("sem Glúten"))).toBe(true);
    expect(names.some((n) => n.includes("Frango"))).toBe(false);
    expect(names.some((n) => n.includes("Banana"))).toBe(false);

    const items = stack.engine.listItems();
    expect(items.find((i) => i.itemId === "Peito de frango")?.resolutionStatus).toBe("excluded");
    expect(items.find((i) => i.itemId === "Banana")?.resolutionStatus).toBe("excluded");
    expect(items.find((i) => i.itemId === "Queijo flamengo")?.resolutionStatus).toBe("unsafe");
  });

  it("uses the quantity in the Bring specification", async () => {
    const stack = makeDemoStack();
    await stack.engine.pollNow();
    const cart = await stack.adapter.getCart();
    const milk = cart.items.find((line) => line.productId === "1001");
    expect(milk?.quantity).toBe(2);
  });

  it("checks ordered items off in Bring, leaving excluded items on the list", async () => {
    const stack = makeDemoStack();
    await stack.engine.pollNow();
    stack.adapter.placeOrder();
    await stack.engine.checkCart();

    const pending = stack.store.pendingCheckouts();
    expect(pending).toHaveLength(1);
    const first = pending[0];
    if (!first) throw new Error("missing pending checkout");
    expect(first.bringUuids).toHaveLength(5);

    const completed = await stack.engine.completeCheckout(first.id);
    expect(completed).toBe(5);

    const items = stack.engine.listItems();
    expect(items.find((i) => i.itemId === "Leite")?.state).toBe("completed");
    expect(items.find((i) => i.itemId === "Peito de frango")?.state).toBe("open");
    expect(items.find((i) => i.itemId === "Banana")?.state).toBe("open");
    expect(items.find((i) => i.itemId === "Queijo flamengo")?.state).toBe("open");
  });

  it("does not resurrect a cart line the user removed", async () => {
    const stack = makeDemoStack();
    await stack.engine.pollNow();
    await stack.adapter.setQuantity("1001", 0);
    await stack.engine.checkCart();

    const milk = stack.engine.listItems().find((i) => i.itemId === "Leite");
    expect(milk?.suppressed).toBe(true);

    stack.bring.add("Atum", "1");
    await stack.engine.pollNow();

    const cart = await stack.adapter.getCart();
    expect(cart.items.find((l) => l.productId === "1001")).toBeUndefined();
    expect(cart.items.find((l) => l.productId === "1009")?.quantity).toBe(4);
  });

  it("refuses to write when the cart would exceed the budget", async () => {
    const stack = makeDemoStack({ MAX_CART_EUR: "1" });
    await stack.engine.pollNow();
    expect((await stack.adapter.getCart()).items).toHaveLength(0);
    expect(stack.store.listEvents(20).some((e) => e.kind === "budget")).toBe(true);
  });

  it("re-adding an item after checkout uses the existing mapping", async () => {
    const stack = makeDemoStack();
    await stack.engine.pollNow();
    stack.adapter.placeOrder();
    await stack.engine.checkCart();
    const first = stack.store.pendingCheckouts()[0];
    if (!first) throw new Error("missing pending checkout");
    await stack.engine.completeCheckout(first.id);

    stack.bring.add("Leite", "1");
    await stack.engine.pollNow();
    const cart = await stack.adapter.getCart();
    expect(cart.items.find((l) => l.productId === "1001")?.quantity).toBe(1);
  });
});
