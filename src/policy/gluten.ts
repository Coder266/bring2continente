import { normalise } from "../util/text.js";

export interface GlutenAnalysis {
  mentionsGluten: boolean;
  mayContain: boolean;
  matched: string[];
  text: string;
}

const GF_CLAIMS = [
  "sem gluten",
  "isento de gluten",
  "gluten free",
  "glutenfree",
  "0 gluten",
  "zero gluten",
  "sem vestigios de gluten",
];

/** Words that are gluten sources in an EU ingredient list. */
const GLUTEN_TERMS = [
  "gluten",
  "trigo",
  "centeio",
  "cevada",
  "aveia",
  "malte",
  "espelta",
  "seitan",
  "semola",
  "bulgur",
  "cuscuz",
  "couscous",
  "pao ralado",
  "farinha de trigo",
  "amido de trigo",
  "proteina de trigo",
  "hidrolisado de trigo",
  "levedura de cerveja",
  "cerveja",
];

/** Terms that contain "trigo"/"gluten" but are not a gluten source. */
const FALSE_FRIENDS = [
  "trigo sarraceno",
  "trigo mourisco",
  "deglutenizado",
  "deglutenizada",
  "deglutenizadas",
  "deglutenizados",
];

const MAY_CONTAIN_GLUTEN = [
  /\b(?:pode conter|pode apresentar|vestigios de|tracos de|may contain|produced in a facility)\b[^.;\n]{0,48}\b(?:gluten|trigo|centeio|cevada|aveia|malte|espelta)\b/,
  /\b(?:gluten|trigo|centeio|cevada|aveia|malte)\b[^.;\n]{0,32}\b(?:vestigios|tracos)\b/,
];

/** Removes gluten-free claims so the word "gluten" in them is not read as an ingredient. */
function stripClaims(text: string): string {
  let out = ` ${text} `;
  for (const claim of GF_CLAIMS) out = out.replaceAll(claim, " ");
  for (const friend of FALSE_FRIENDS) out = out.replaceAll(friend, " ");
  return out;
}

export function analyseGlutenText(...parts: Array<string | undefined>): GlutenAnalysis {
  const text = normalise(parts.filter(Boolean).join(" \n "));
  const scanned = stripClaims(text);
  const matched = GLUTEN_TERMS.filter((term) => scanned.includes(term));
  return {
    mentionsGluten: matched.length > 0,
    mayContain: MAY_CONTAIN_GLUTEN.some((pattern) => pattern.test(scanned)),
    matched,
    text,
  };
}

export function nameSaysGlutenFree(name: string): boolean {
  const text = normalise(name);
  return GF_CLAIMS.some((claim) => text.includes(claim));
}

export type GlutenMode = "strict" | "standard" | "off";

export interface GlutenInput {
  name: string;
  hasGlutenFreeBadge: boolean;
  ingredients?: string;
  allergens?: string;
  /** True when the user confirmed a naturally gluten-free product once. */
  userVerified: boolean;
}

export interface GlutenDecision {
  allow: boolean;
  verdict: "certified" | "naturally_gf" | "risk" | "unknown";
  reason: string;
}

/**
 * The safety-critical gate. It fails closed: anything we cannot positively
 * classify as gluten-free is not allowed into the cart.
 */
export function decideGluten(input: GlutenInput, mode: GlutenMode): GlutenDecision {
  if (mode === "off") {
    return { allow: true, verdict: "certified", reason: "Gluten checks disabled" };
  }

  const analysis = analyseGlutenText(input.ingredients, input.allergens);
  const claim = input.hasGlutenFreeBadge || nameSaysGlutenFree(input.name);

  if (analysis.mentionsGluten) {
    return {
      allow: false,
      verdict: "risk",
      reason: `Ingredients mention a gluten source (${analysis.matched.join(", ")})`,
    };
  }

  if (analysis.mayContain && mode === "strict") {
    return {
      allow: false,
      verdict: "risk",
      reason: "Label warns it may contain traces of gluten",
    };
  }

  if (claim) {
    return {
      allow: true,
      verdict: "certified",
      reason: input.hasGlutenFreeBadge
        ? "Continente marks this product as gluten-free"
        : 'Product name says "sem glúten"',
    };
  }

  const hasLabel = Boolean((input.ingredients ?? "").trim() || (input.allergens ?? "").trim());
  if (hasLabel && input.userVerified) {
    return {
      allow: true,
      verdict: "naturally_gf",
      reason: "No gluten in the label and you confirmed this product once",
    };
  }
  if (hasLabel) {
    return {
      allow: false,
      verdict: "unknown",
      reason: "No gluten in the label, but it has no gluten-free claim — confirm it once",
    };
  }
  return {
    allow: false,
    verdict: "unknown",
    reason: "No gluten information available — refusing to guess",
  };
}
