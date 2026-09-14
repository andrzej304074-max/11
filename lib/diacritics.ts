/**
 * Vinted's label fonts have no Polish glyphs and drop them without a replacement
 * character, so the text layer literally contains "Mska" instead of "Męska".
 * Whole-word substitutions; heuristic by nature, which is why every title stays
 * editable in the UI before generating.
 */
export const DIACRITICS: Record<string, string> = {
  Mska: "Męska",
  Mskie: "Męskie",
  Biaa: "Biała",
  Biae: "Białe",
  Biaymi: "Białymi",
  Materiaowe: "Materiałowe",
  Krat: "Kratę",
  Kratk: "Kratkę",
  Panterk: "Panterkę",
  Rowe: "Różowe",
  "Rowo-Biaa": "Różowo-Biała",
  Dugim: "Długim",
  Rkawem: "Rękawem",
  te: "żółte",
};

const LOOKUP = new Map<string, string>();
for (const [k, v] of Object.entries(DIACRITICS)) LOOKUP.set(k.toLowerCase(), v);

/** Match case of the replacement to the case of the source word. */
function matchCase(source: string, replacement: string): string {
  if (source === source.toUpperCase() && source !== source.toLowerCase()) {
    return replacement.toUpperCase();
  }
  const firstIsUpper = source[0] === source[0]?.toUpperCase();
  if (firstIsUpper) {
    return replacement[0].toUpperCase() + replacement.slice(1);
  }
  return replacement.toLowerCase();
}

/** Repair missing Polish diacritics word by word. */
export function fixDiacritics(text: string): string {
  return text.replace(/[\p{L}-]+/gu, (word) => {
    const hit = LOOKUP.get(word.toLowerCase());
    return hit ? matchCase(word, hit) : word;
  });
}
