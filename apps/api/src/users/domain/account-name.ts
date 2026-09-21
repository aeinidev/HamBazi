/** Plain display text, never an HTML fragment or an identity credential. */
export function normalizeDisplayName(input: unknown): string | undefined {
  if (typeof input !== "string" || input.length > 256) return;
  for (const character of input) {
    const point = character.codePointAt(0)!;
    if (
      (point >= 0xd800 && point <= 0xdfff) ||
      /[\p{Cc}\p{Zl}\p{Zp}]/u.test(character) ||
      (/\p{Cf}/u.test(character) && character !== "\u200c" && character !== "\u200d")
    )
      return;
  }
  const name = input.normalize("NFC").replace(/ +/g, " ").replace(/^ | $/g, "");
  if ([...name].length < 1 || [...name].length > 40 || !/[\p{L}\p{N}\p{P}\p{S}]/u.test(name))
    return;
  return name;
}

export function handleBase(displayName: string): string {
  const folded = displayName.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
  if (!/^[a-z0-9 _-]+$/.test(folded)) return "user";
  const base = folded.replace(/[ _-]+/g, "_").replace(/^_|_$/g, "");
  return /^[a-z]/.test(base) ? base.slice(0, 20).replace(/_$/, "") : "user";
}
