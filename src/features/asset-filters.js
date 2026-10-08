export function compilePattern(source, flags = 'i', label = 'Regular expression') {
  source = String(source || '').trim();
  if (!source) return null;
  if (source.length > 1000) throw new Error(`${label} is too long (maximum 1,000 characters).`);
  if (!/^[imsu]*$/.test(flags) || new Set(flags).size !== flags.length) throw new Error(`${label}: use only i, m, s, and u flags, without duplicates.`);
  try { return new RegExp(source, flags); }
  catch (error) { throw new Error(`${label}: ${error.message}`, { cause: error }); }
}

export function messageUrls(message) {
  const urls = new Set();
  const text = String(message.content || '');
  for (const match of text.matchAll(/https?:\/\/[^\s<>`"']+/gi)) {
    let url = match[0].replace(/[.,!;:]+$/, '');
    for (const marker of ['**', '__', '~~', '||', '*', '_']) {
      if (text.slice(0, match.index).endsWith(marker) && url.endsWith(marker)) url = url.slice(0, -marker.length);
    }
    while (url.endsWith(')') && (url.match(/\)/g) || []).length > (url.match(/\(/g) || []).length) url = url.slice(0, -1);
    if (url) urls.add(url);
  }
  for (const embed of message.embeds || []) {
    const url = embed.url || embed.image?.url;
    if (/^https?:\/\//i.test(url || '')) urls.add(url);
  }
  return [...urls];
}

export function assetsFor(message) {
  const assets = (message.attachments || []).map(file => ({ name: String(file.filename || ''), url: String(file.url || '') }));
  for (const url of messageUrls(message)) {
    try {
      const path = new URL(url).pathname;
      let name = path.split('/').at(-1) || '';
      try { name = decodeURIComponent(name); } catch {}
      assets.push({ name, url });
    } catch {}
  }
  return assets;
}

export function matchesAssets(message, options) {
  if (!options.filename && !options.extensions.length && !options.assetPattern) return true;
  const matches = assetsFor(message).some(asset => {
    if (options.filename && !asset.name.toLowerCase().includes(options.filename.toLowerCase())) return false;
    const extension = asset.name.match(/\.([^.]+)$/)?.[1]?.toLowerCase() || '';
    if (options.extensions.length && !options.extensions.includes(extension)) return false;
    if (options.assetPattern && !options.assetPattern.test(`${asset.name}\n${asset.url}`)) return false;
    return true;
  });
  return options.assetMode === 'exclude' ? !matches : matches;
}
