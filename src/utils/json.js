// Preserve large integer IDs before JSON.parse can round them.
export function parseIdJson(text) {
  const input = String(text).replace(/^\uFEFF/, '');
  let output = '', inString = false;
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (inString) {
      output += char;
      if (char === '\\') { output += input[++i] || ''; }
      else if (char === '"') inString = false;
    } else if (char === '"') {
      inString = true; output += char;
    } else if (char === '-' || /\d/.test(char)) {
      const number = input.slice(i).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);
      if (!number) { output += char; continue; }
      const token = number[0];
      output += /^\d{16,}$/.test(token) ? JSON.stringify(token) : token;
      i += token.length - 1;
    } else output += char;
  }
  return JSON.parse(output);
}
