// Count exported messages without constructing their contents or attachments.
// The scanner validates JSON and retains only nesting state and the root key.
const SMALL_JSON_LIMIT = 64 * 1024;
const parsedCount = text => {
  const data = JSON.parse(text || '[]');
  return Array.isArray(data) ? data.length : Array.isArray(data?.messages) ? data.messages.length : data && typeof data === 'object' && Object.keys(data).length ? 1 : 0;
};

export async function countJsonMessages(file) {
  // Native parsing is faster for bounded metadata-sized files. Large exports
  // take the streaming path so their message objects never enter the heap.
  if (Number.isFinite(file.size) && file.size <= SMALL_JSON_LIMIT && typeof file.text === 'function') return parsedCount(await file.text());
  let fallbackText;
  if (typeof file.stream !== 'function') {
    fallbackText = await file.text() || '[]';
    if (fallbackText.length <= SMALL_JSON_LIMIT) return parsedCount(fallbackText);
  }
  const stack = [];
  const frames = [];
  // JSON string delimiters, escapes and forbidden unescaped control bytes.
  // eslint-disable-next-line no-control-regex
  const stringMarker = /["\\\x00-\x1f]/g;
  let rootState = 'value', rootType = '', rootFields = 0, result = 0;
  let messagesCount = null, token = '', literal = '', literalIndex = 0;
  let escape = false, unicode = 0, unicodeValue = 0, sawInput = false;
  let key = false, keyMatch = true, keyLength = 0;
  const fail = () => { throw new SyntaxError('Invalid message JSON.'); };
  const frame = () => stack[stack.length - 1];
  const acceptValue = type => {
    const parent = frame();
    if (!parent) {
      if (rootState !== 'value') fail();
      rootState = 'end'; rootType = type;
    } else if (parent.type === 'array') {
      if (parent.state !== 'first' && parent.state !== 'value') fail();
      parent.state = 'comma'; parent.count++;
    } else {
      if (parent.state !== 'value') fail();
      parent.state = 'comma';
      if (stack.length === 1 && parent.messagesKey) messagesCount = null;
    }
  };
  const emitKeyCharacter = character => {
    if (key) {
      if (character !== 'messages'.charCodeAt(keyLength)) keyMatch = false;
      keyLength++;
    }
  };
  const numberCharacter = character => {
    const digit = character >= 48 && character <= 57;
    switch (token) {
      case 'minus': if (character === 48) token = 'zero'; else if (digit) token = 'integer'; else fail(); break;
      case 'zero': if (character === 46) token = 'dot'; else if (character === 69 || character === 101) token = 'exponent'; else return false; break;
      case 'integer': if (digit) break; if (character === 46) token = 'dot'; else if (character === 69 || character === 101) token = 'exponent'; else return false; break;
      case 'dot': if (!digit) fail(); token = 'fraction'; break;
      case 'fraction': if (digit) break; if (character === 69 || character === 101) token = 'exponent'; else return false; break;
      case 'exponent': if (character === 43 || character === 45) token = 'exponentSign'; else if (digit) token = 'exponentDigits'; else fail(); break;
      case 'exponentSign': if (!digit) fail(); token = 'exponentDigits'; break;
      case 'exponentDigits': if (!digit) return false; break;
    }
    return true;
  };
  const consume = text => {
    if (text.length) sawInput = true;
    for (let i = 0; i < text.length; i++) {
      let character = text.charCodeAt(i);
      if (token === 'string') {
        if ((!key || stack.length > 1) && !escape && !unicode) {
          stringMarker.lastIndex = i;
          if (!stringMarker.test(text)) break;
          i = stringMarker.lastIndex - 1;
          character = text.charCodeAt(i);
        }
        if (unicode) {
          const digit = character >= 48 && character <= 57 ? character - 48 : character >= 65 && character <= 70 ? character - 55 : character >= 97 && character <= 102 ? character - 87 : -1;
          if (digit < 0) fail();
          unicodeValue = unicodeValue * 16 + digit;
          if (--unicode === 0) emitKeyCharacter(unicodeValue);
        } else if (escape) {
          escape = false;
          if (character === 117) { unicode = 4; unicodeValue = 0; }
          else {
            if (![34, 92, 47, 98, 102, 110, 114, 116].includes(character)) fail();
            emitKeyCharacter(character === 98 ? 8 : character === 102 ? 12 : character === 110 ? 10 : character === 114 ? 13 : character === 116 ? 9 : character);
          }
        } else if (character === 92) escape = true;
        else if (character === 34) {
          token = '';
          if (key) {
            const parent = frame();
            parent.state = 'colon';
            parent.messagesKey = keyMatch && keyLength === 8;
            if (stack.length === 1) rootFields++;
          }
          key = false;
        } else {
          if (character < 32) fail();
          emitKeyCharacter(character);
        }
        continue;
      }
      if (token === 'literal') {
        if (character !== literal.charCodeAt(literalIndex++)) fail();
        if (literalIndex === literal.length) token = '';
        continue;
      }
      if (token) {
        if (numberCharacter(character)) continue;
        token = '';
      }
      if (character === 32 || character === 9 || character === 10 || character === 13) continue;
      const parent = frame();
      if (character === 34) {
        key = !!parent && parent.type === 'object' && (parent.state === 'first' || parent.state === 'key');
        if (key) { keyMatch = true; keyLength = 0; }
        else acceptValue('string');
        token = 'string';
      } else if (character === 91 || character === 123) {
        const type = character === 91 ? 'array' : 'object';
        const messages = stack.length === 1 && parent.type === 'object' && parent.messagesKey && type === 'array';
        acceptValue(type);
        // Reuse one frame per nesting level across all exported messages.
        const nested = frames[stack.length] || (frames[stack.length] = {});
        nested.type = type; nested.state = 'first'; nested.count = 0;
        nested.messages = messages; nested.messagesKey = false;
        stack.push(nested);
      } else if (character === 93 || character === 125) {
        if (!parent || parent.type !== (character === 93 ? 'array' : 'object') || (parent.state !== 'first' && parent.state !== 'comma')) fail();
        stack.pop();
        if (parent.messages) messagesCount = parent.count;
        if (!stack.length && parent.type === 'array') result = parent.count;
      } else if (character === 44) {
        if (!parent || parent.state !== 'comma') fail();
        parent.state = parent.type === 'array' ? 'value' : 'key';
      } else if (character === 58) {
        if (!parent || parent.type !== 'object' || parent.state !== 'colon') fail();
        parent.state = 'value';
      } else if (character === 116 || character === 102 || character === 110) {
        acceptValue('literal');
        token = 'literal'; literal = character === 116 ? 'true' : character === 102 ? 'false' : 'null'; literalIndex = 1;
      } else if (character === 45 || (character >= 48 && character <= 57)) {
        acceptValue('number');
        token = character === 45 ? 'minus' : character === 48 ? 'zero' : 'integer';
      } else fail();
    }
  };
  if (typeof file.stream === 'function') {
    const reader = file.stream().getReader();
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let finished = false;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        // Streams can supply a whole Blob as one chunk. Decode bounded slices
        // so the temporary string remains small even with such a producer.
        for (let offset = 0; offset < value.length; offset += SMALL_JSON_LIMIT) {
          consume(decoder.decode(value.subarray(offset, offset + SMALL_JSON_LIMIT), { stream: true }));
        }
      }
      consume(decoder.decode());
      finished = true;
    } finally {
      if (!finished) { try { await reader.cancel(); } catch {} }
      reader.releaseLock();
    }
  } else consume(fallbackText);
  if (!sawInput) return 0;
  if (stack.length || rootState !== 'end' || (token && !['zero', 'integer', 'fraction', 'exponentDigits'].includes(token))) fail();
  return rootType === 'array' ? result : rootType === 'object' ? messagesCount ?? (rootFields ? 1 : 0) : 0;
}
