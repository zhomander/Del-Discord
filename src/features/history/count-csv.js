// Count logical CSV records, including quoted multiline fields, in bounded chunks.
export async function countCsvMessages(file) {
  let quoted = false, hasData = false, records = 0;
  const consume = text => {
    for (let index = 0; index < text.length; index++) {
      const character = text.charCodeAt(index);
      if (character === 34) quoted = !quoted;
      if (!quoted && (character === 10 || character === 13)) {
        if (hasData) records++;
        hasData = false;
      } else if (character > 32 && character !== 0xfeff) hasData = true;
    }
  };
  if (typeof file.stream === 'function') {
    const reader = file.stream().getReader();
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        for (let offset = 0; offset < value.length; offset += 64 * 1024) {
          consume(decoder.decode(value.subarray(offset, offset + 64 * 1024), { stream: true }));
        }
      }
      consume(decoder.decode());
    } finally { reader.releaseLock(); }
  } else consume(await file.text());
  if (hasData) records++;
  return Math.max(0, records - 1); // The first record is the header.
}
