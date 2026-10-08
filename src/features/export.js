// Del-Discord v1 — personal source modules.
import { toSnowflake } from '../utils/messages.js';
import { API } from '../config.js';
import { apiFetch, RunStoppedError } from '../discord/api.js';
import { invalidateAuth } from '../discord/deleter-auth.js';
import { rand, sleep } from '../utils/timing.js';

export function compactReferencedMessage(message) {
  if (!message) return null;
  return {
    id: message.id || null,
    timestamp: message.timestamp || null,
    content: message.content || '',
    author: message.author ? {
      id: message.author.id || null,
      username: message.author.username || '',
      globalName: message.author.global_name || null,
      bot: !!message.author.bot
    } : null
  };
}

export function compactExportMessage(message) {
  return {
    id: message.id,
    timestamp: message.timestamp,
    editedTimestamp: message.edited_timestamp || null,
    type: message.type,
    pinned: !!message.pinned,
    content: message.content || '',
    author: message.author ? {
      id: message.author.id || null,
      username: message.author.username || '',
      globalName: message.author.global_name || null,
      discriminator: message.author.discriminator || null,
      bot: !!message.author.bot
    } : null,
    attachments: (message.attachments || []).map(a => ({
      id: a.id,
      filename: a.filename,
      description: a.description || null,
      contentType: a.content_type || null,
      size: a.size || 0,
      url: a.url,
      proxyUrl: a.proxy_url || null,
      width: a.width || null,
      height: a.height || null
    })),
    embeds: message.embeds || [],
    reactions: (message.reactions || []).map(r => ({
      count: r.count,
      emoji: r.emoji,
      me: !!r.me
    })),
    mentions: (message.mentions || []).map(u => ({
      id: u.id,
      username: u.username || '',
      globalName: u.global_name || null
    })),
    referencedMessage: compactReferencedMessage(message.referenced_message)
  };
}

export async function exportConversationData({ token, guildId, channelId, minId, maxId, label, log, stopCheck = () => false }) {
  const afterSnowflake = minId ? toSnowflake(minId) : '';
  let beforeSnowflake = maxId ? toSnowflake(maxId) : '';
  let afterBig = null;
  try { if (afterSnowflake) afterBig = BigInt(afterSnowflake); } catch {}

  const messages = [];
  const seen = new Set();
  let page = 0;

  log('info', `Exporting conversation ${label || channelId}...`);

  while (!stopCheck()) {
    const url = `${API}/channels/${channelId}/messages?limit=100${beforeSnowflake ? `&before=${beforeSnowflake}` : ''}`;
    let response;
    try {
      response = await apiFetch(url, { headers: { Authorization: token } }, log, stopCheck);
    } catch (error) {
      if (error instanceof RunStoppedError) break;
      throw error;
    }
    if (stopCheck()) break;

    if (response.status === 401) {
      invalidateAuth();
      throw new Error('Discord rejected the authorization token while exporting.');
    }
    if (response.status === 403) throw new Error('Discord denied access to this conversation.');
    if (!response.ok) throw new Error(`Conversation export failed with HTTP ${response.status}.`);

    const batch = await response.json();
    if (!Array.isArray(batch) || !batch.length) break;

    page++;
    let oldest = null;
    let reachedAfter = false;

    for (const message of batch) {
      let idBig = null;
      try { idBig = BigInt(message.id); } catch {}
      if (idBig === null) continue;
      if (beforeSnowflake && idBig >= BigInt(beforeSnowflake)) continue;
      if (afterBig !== null && idBig !== null && idBig <= afterBig) {
        reachedAfter = true;
        continue;
      }
      if (!seen.has(message.id)) {
        seen.add(message.id);
        messages.push(compactExportMessage(message));
      }
      if (idBig !== null && (oldest === null || idBig < oldest)) oldest = idBig;
    }

    log('verb', `Export page ${page}: ${messages.length} messages collected.`);

    if (reachedAfter || oldest === null) break;
    beforeSnowflake = oldest.toString();
    await sleep(rand(550, 900));
  }

  messages.sort((a, b) => {
    try {
      const aa = BigInt(a.id), bb = BigInt(b.id);
      return aa < bb ? -1 : aa > bb ? 1 : 0;
    } catch {
      return String(a.timestamp || '').localeCompare(String(b.timestamp || ''));
    }
  });

  return {
    exportedAt: new Date().toISOString(),
    guildId,
    channelId,
    label: label || '',
    range: {
      after: minId || null,
      before: maxId || null
    },
    messageCount: messages.length,
    messages
  };
}
