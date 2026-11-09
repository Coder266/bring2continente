const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
  "&aacute;": "á",
  "&agrave;": "à",
  "&acirc;": "â",
  "&atilde;": "ã",
  "&eacute;": "é",
  "&ecirc;": "ê",
  "&iacute;": "í",
  "&oacute;": "ó",
  "&ocirc;": "ô",
  "&otilde;": "õ",
  "&uacute;": "ú",
  "&ccedil;": "ç",
  "&Aacute;": "Á",
  "&Atilde;": "Ã",
  "&Ccedil;": "Ç",
};

/** Decodes the handful of HTML entities Continente emits in product/category names. */
export function decodeEntities(input: string): string {
  return input
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&[a-zA-Z]+;/g, (entity) => ENTITIES[entity] ?? entity);
}

/** Lowercase, strip diacritics and collapse everything that is not a letter/digit. */
export function normalise(input: string): string {
  return decodeEntities(input)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function tokens(input: string): string[] {
  return normalise(input)
    .split(" ")
    .filter((t) => t.length > 1);
}

const IRREGULAR_PLURALS: Record<string, string> = {
  paes: "pao",
  alemaes: "alemao",
  caes: "cao",
  gizes: "gis",
};

/** A deliberately small Portuguese singulariser for list-item matching. */
export function singular(word: string): string {
  if (IRREGULAR_PLURALS[word]) return IRREGULAR_PLURALS[word];
  if (word.length <= 3) return word;
  if (word.endsWith("oes")) return `${word.slice(0, -3)}ao`;
  if (word.endsWith("aes")) return `${word.slice(0, -3)}ao`;
  if (word.endsWith("ais")) return `${word.slice(0, -3)}al`;
  if (word.endsWith("eis")) return `${word.slice(0, -3)}el`;
  if (word.endsWith("ns")) return word.slice(0, -2);
  if (word.endsWith("es")) return word.slice(0, -2);
  if (word.endsWith("s")) return word.slice(0, -1);
  return word;
}

export function singularTokens(input: string): string[] {
  return tokens(input).map(singular);
}

export function sameText(a: string, b: string): boolean {
  return normalise(a) === normalise(b);
}

/** Parses a leading quantity from a Bring! specification ("2", "2x", "1 kg", "500 g"). */
export function parseSpecQuantity(spec: string): { quantity: number; unit?: string } | null {
  const text = normalise(spec);
  if (!text) return null;
  const match = text.match(/^(\d+(?:[.,]\d+)?)\s*(x|un|unid|kg|g|l|ml|litro|litros)?\b/);
  if (!match) return null;
  const quantity = Number((match[1] ?? "").replace(",", "."));
  if (!Number.isFinite(quantity) || quantity <= 0) return null;
  return { quantity, unit: match[2] };
}
