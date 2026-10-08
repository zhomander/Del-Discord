import { resolveConversation } from './conversation.js';

// Only visual detection is cached. Cleanup still resolves fresh channel metadata.
export function createConversationPreviewResolver(resolve = resolveConversation, now = Date.now) {
  let cached = null, pending = null;
  const matches = (entry, options) => entry?.token === options.token && entry?.channelId === options.channelId;
  return async options => {
    if (matches(cached, options) && now() - cached.at < 30000) return cached.target;
    if (matches(pending, options)) return pending.promise;
    const job = { token: options.token, channelId: options.channelId };
    pending = job;
    job.promise = Promise.resolve().then(() => resolve(options)).then(target => {
      if (pending === job) cached = { token: job.token, channelId: job.channelId, target, at: now() };
      return target;
    }).finally(() => { if (pending === job) pending = null; });
    return job.promise;
  };
}
