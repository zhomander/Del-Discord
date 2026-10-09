// Preserve large integer IDs before JSON.parse can round them.
export function parseIdJson(text) {
  const input = String(text).replace(/^\uFEFF/, '');
  const parts = [];
  const number = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
  let copied = 0, inString = false;
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (inString) {
      if (char === '\\') i++;
      else if (char === '"') inString = false;
    } else if (char === '"') {
      inString = true;
    } else if (char === '-' || (char >= '0' && char <= '9')) {
      number.lastIndex = i;
      const match = number.exec(input);
      if (!match) continue;
      const token = match[0];
      if (/^\d{16,}$/.test(token)) {
        parts.push(input.slice(copied, i), '"', token, '"');
        copied = i + token.length;
      }
      i += token.length - 1;
    }
  }
  if (!parts.length) return JSON.parse(input);
  parts.push(input.slice(copied));
  return JSON.parse(parts.join(''));
}
