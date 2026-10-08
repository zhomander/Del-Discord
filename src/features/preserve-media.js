import { messageUrls } from './asset-filters.js';

export function preservedContent(message) {
  const urls = messageUrls(message);
  if (!urls.length && !message.attachments?.length) return null;
  const content = urls.join('\n');
  // Keep the message unchanged rather than truncating a URL or creating invalid content.
  if (content.length > 2000) return null;
  return content;
}
