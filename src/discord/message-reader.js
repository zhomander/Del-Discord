import { API } from '../config.js';
import { apiFetch, RunStoppedError } from './api.js';

// Some account types cannot use the individual-message endpoint. Read a small
// history window instead, and accept only the exact requested message.
export function createMessageReader(token, log, stopCheck = () => false) {
  let useHistory = false;
  return async (channelId, messageId) => {
    const options = { headers: { Authorization: token } };
    if (!useHistory) {
      const response = await apiFetch(`${API}/channels/${channelId}/messages/${messageId}`, options, log, stopCheck);
      if (response.status !== 403) return response;
      useHistory = true;
    }
    if (stopCheck()) throw new RunStoppedError();
    const response = await apiFetch(`${API}/channels/${channelId}/messages?around=${messageId}&limit=3`, options, log, stopCheck);
    if (!response.ok) return response;
    const messages = await response.json();
    if (!Array.isArray(messages)) throw new Error('Discord returned invalid message history. Stopping before changes.');
    const message = messages.find(item => item.id === messageId && item.channel_id === channelId);
    return message ? Response.json(message) : new Response(null, { status: 404 });
  };
}
