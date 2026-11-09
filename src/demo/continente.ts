import type { ContinenteAdapter } from "../continente/adapter.js";
import type { Cart, Order, OrderLine, Product, ProductLabels } from "../types.js";

interface DemoProduct extends Product {
  glutenFree: boolean;
  ingredients: string;
  allergens: string;
}

const PRODUCTS: DemoProduct[] = [
  {
    id: "1001",
    name: "Leite Meio Gordo Continente 1 L",
    brand: "Continente",
    category: "Supermercado/Laticínios e Ovos/Leite",
    packageText: "1 L",
    price: 0.89,
    glutenFree: true,
    ingredients: "Leite meio gordo.",
    allergens: "Leite.",
  },
  {
    id: "1002",
    name: "Leite com Chocolate Continente 1 L",
    brand: "Continente",
    category: "Supermercado/Laticínios e Ovos/Leite",
    packageText: "1 L",
    price: 1.29,
    glutenFree: true,
    ingredients: "Leite, açúcar, cacau em pó.",
    allergens: "Leite.",
  },
  {
    id: "1003",
    name: "Pão de Forma Integral sem Glúten Continente 300 g",
    brand: "Continente",
    category: "Supermercado/Padaria e Pastelaria/Pão de Forma",
    packageText: "300 g",
    price: 2.75,
    glutenFree: true,
    ingredients: "Água, amido de milho, farinha de arroz, sementes.",
    allergens: "Pode conter vestígios de leite.",
  },
  {
    id: "1004",
    name: "Pão de Forma Branco Continente 400 g",
    brand: "Continente",
    category: "Supermercado/Padaria e Pastelaria/Pão de Forma",
    packageText: "400 g",
    price: 1.59,
    glutenFree: false,
    ingredients: "Farinha de trigo, água, fermento, sal.",
    allergens: "Glúten.",
  },
  {
    id: "1005",
    name: "Peito de Frango Continente",
    brand: "Continente",
    category: "Supermercado/Talho/Frango",
    packageText: "aprox. 500 g",
    price: 4.49,
    glutenFree: true,
    ingredients: "Carne de frango.",
    allergens: "",
  },
  {
    id: "1006",
    name: "Banana Continente",
    brand: "Continente",
    category: "Supermercado/Frutas e Legumes/Frutas/Banana",
    packageText: "1 kg",
    price: 1.39,
    glutenFree: true,
    ingredients: "Banana.",
    allergens: "",
  },
  {
    id: "1007",
    name: "Bolachas Maria Continente 200 g",
    brand: "Continente",
    category: "Supermercado/Mercearia/Bolachas e Biscoitos",
    packageText: "200 g",
    price: 1.19,
    glutenFree: false,
    ingredients: "Farinha de trigo, açúcar, óleo vegetal.",
    allergens: "Glúten.",
  },
  {
    id: "1008",
    name: "Bolachas sem Glúten Continente 150 g",
    brand: "Continente",
    category: "Supermercado/Mercearia/Bolachas e Biscoitos",
    packageText: "150 g",
    price: 2.29,
    glutenFree: true,
    ingredients: "Amido de milho, açúcar, ovo.",
    allergens: "Ovo. Pode conter vestígios de leite.",
  },
  {
    id: "1009",
    name: "Atum em Óleo Bom Petisco 3 x 80 g",
    brand: "Bom Petisco",
    category: "Supermercado/Mercearia/Conservas/Atum",
    packageText: "3 x 80 g",
    price: 3.69,
    glutenFree: true,
    ingredients: "Atum, óleo vegetal, sal.",
    allergens: "",
  },
  {
    id: "1010",
    name: "Queijo Flamengo Fatiado Continente 200 g",
    brand: "Continente",
    category: "Supermercado/Charcutaria e Queijos/Queijo",
    packageText: "200 g",
    price: 2.49,
    glutenFree: false,
    ingredients: "Leite, sal, fermentos lácteos.",
    allergens: "Leite.",
  },
  {
    id: "1011",
    name: "Detergente Loiça Continente 1 L",
    brand: "Continente",
    category: "Supermercado/Limpeza/Detergentes",
    packageText: "1 L",
    price: 1.49,
    glutenFree: true,
    ingredients: "Tensioactivos, perfume.",
    allergens: "",
  },
];

export class DemoContinente implements ContinenteAdapter {
  readonly name = "demo";
  private cart = new Map<string, number>();
  private orders: Order[] = [];

  async search(query: string, limit: number): Promise<Product[]> {
    const wantGf = /sem gluten/i.test(query);
    const words = query
      .toLowerCase()
      .replace(/sem gluten/g, "")
      .split(/\s+/)
      .map((w) => w.replace(/[^a-z0-9à-ú]/g, ""))
      .filter(Boolean);
    return PRODUCTS.filter((p) => !wantGf || p.glutenFree)
      .filter((p) => words.length === 0 || words.some((w) => p.name.toLowerCase().includes(w)))
      .slice(0, limit)
      .map((p) => this.product(p));
  }

  async getProduct(productId: string): Promise<Product | null> {
    const found = PRODUCTS.find((p) => p.id === productId);
    return found ? this.product(found) : null;
  }

  async getLabels(productIds: string[]): Promise<ProductLabels[]> {
    return productIds.map((id) => {
      const p = PRODUCTS.find((x) => x.id === id);
      return {
        productId: id,
        ingredients: p?.ingredients,
        allergens: p?.allergens,
        mayContain: /pode conter/i.test(p?.allergens ?? "") ? p?.allergens : undefined,
      };
    });
  }

  async getCart(): Promise<Cart> {
    const items = [...this.cart.entries()]
      .map(([id, qty]) => {
        const p = PRODUCTS.find((x) => x.id === id);
        if (!p) return null;
        return {
          productId: id,
          name: p.name,
          quantity: qty,
          unit: "un",
          price: p.price,
          lineTotal: (p.price ?? 0) * qty,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
    const products = items.reduce((sum, i) => sum + (i.lineTotal ?? 0), 0);
    return {
      observedAt: new Date().toISOString(),
      authenticated: true,
      items,
      totals: { products, grandTotal: products, estimated: false },
      checkout: {
        minimumOrder: 20,
        meetsMinimum: products >= 20,
        entregaZero: false,
        freeDeliveryFrom: null,
        deliveryFee: "set_at_checkout",
      },
    };
  }

  async add(productId: string, quantity: number): Promise<Cart> {
    return this.setQuantity(productId, (this.cart.get(productId) ?? 0) + quantity);
  }

  async setQuantity(productId: string, quantity: number): Promise<Cart> {
    if (!PRODUCTS.some((p) => p.id === productId)) {
      throw new Error(`Unknown demo product ${productId}`);
    }
    if (quantity <= 0) this.cart.delete(productId);
    else this.cart.set(productId, quantity);
    return this.getCart();
  }

  async remove(productId: string): Promise<Cart> {
    this.cart.delete(productId);
    return this.getCart();
  }

  async listOrders(limit: number): Promise<Order[]> {
    return this.orders.slice(0, limit);
  }

  async frequentlyBought(limit: number): Promise<Product[]> {
    return PRODUCTS.slice(0, limit).map((p) => ({ ...this.product(p), source: "history" }));
  }

  async sessionStatus(): Promise<{ authenticated: boolean; detail?: string }> {
    return { authenticated: true, detail: "demo" };
  }

  async close(): Promise<void> {}

  isGlutenFree(productId: string): boolean {
    return Boolean(PRODUCTS.find((p) => p.id === productId)?.glutenFree);
  }

  /** Demo-only: the user pressed "deliver". */
  placeOrder(): Order {
    const lines: OrderLine[] = [...this.cart.entries()].map(([id, qty]) => {
      const p = PRODUCTS.find((x) => x.id === id);
      return {
        productId: id,
        name: p?.name ?? id,
        quantity: qty,
        lineTotal: (p?.price ?? 0) * qty,
      };
    });
    const order: Order = {
      id: `demo-order-${this.orders.length + 1}`,
      number: `2026${String(this.orders.length + 1).padStart(4, "0")}`,
      placedAt: new Date().toISOString(),
      lines,
    };
    this.orders.unshift(order);
    this.cart.clear();
    return order;
  }

  private product(p: DemoProduct): Product {
    return {
      id: p.id,
      name: p.name,
      brand: p.brand,
      category: p.category,
      packageText: p.packageText,
      price: p.price,
      availability: "in stock",
      url: `https://www.continente.pt/produto/demo-${p.id}.html`,
      source: "search",
    };
  }
}
