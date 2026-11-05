const NumberToken = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;

// A double holds 15 significant digits exactly; past that, or past the safe integer range,
// JSON.parse would round the value.
const isLossy = (token: string) => {
  if (/^-?\d+$/.test(token)) return !Number.isSafeInteger(Number(token));
  const mantissa = token.split(/[eE]/)[0].replace(/[-.]/g, "");
  return mantissa.replace(/^0+/, "").replace(/0+$/, "").length > 15;
};

/**
 * JSON.parse, except numbers a double can't hold exactly come back as their text. Drizzle's
 * relational queries return nested rows as `json`, so without this a `numeric(78, 0)` amount
 * on a related row is rounded before Drizzle turns it into a bigint.
 */
export const parseJsonExact = (text: string): unknown => {
  let out = "";
  let last = 0;
  let inString = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === "-" || (ch >= "0" && ch <= "9")) {
      NumberToken.lastIndex = i;
      const match = NumberToken.exec(text);
      if (!match) continue;

      const token = match[0];
      if (isLossy(token)) {
        out += `${text.slice(last, i)}"${token}"`;
        last = i + token.length;
      }
      i += token.length - 1;
    }
  }

  return JSON.parse(last === 0 ? text : out + text.slice(last));
};
