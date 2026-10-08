import { parseMessageReference } from '../utils/messages.js';
import { parseCsv } from '../utils/csv.js';
import { parseIdJson } from '../utils/json.js';

function snowflake(value, label) {
  if (typeof value !== 'string' || !/^\d{15,22}$/.test(value.trim())) {
    throw new Error(`${label} must be a full Discord ID stored as text.`);
  }
  return value.trim();
}

export function uniqueTargets(targets) {
  const map = new Map();
  for (const target of targets) {
    const channelId = snowflake(target.channelId, 'Channel ID');
    const messageId = snowflake(target.messageId, 'Message ID');
    map.set(`${channelId}/${messageId}`, { channelId, messageId });
  }
  return [...map.values()];
}

function fromRecords(records, channelId) {
  return records.map(record => {
    if (typeof record === 'string') {
      const ref = parseMessageReference(record);
      if (!ref) throw new Error('Invalid message ID or link.');
      return { channelId: ref.channelId || channelId, messageId: ref.messageId };
    }
    if (!record || typeof record !== 'object') throw new Error('Message IDs must be strings or message records.');
    return {
      channelId: record.channel_id || record.channelId || channelId,
      messageId: record.id || record.ID || record.message_id || record.messageId,
    };
  });
}

export function parseMessageIds(text, channelId = '') {
  const input = String(text || '').trim();
  if (!input) return [];
  if (/^[[{]/.test(input)) {
    const parsed = parseIdJson(input);
    if (!parsed || typeof parsed !== 'object') throw new Error('Choose a JSON message array or message record.');
    const records = Array.isArray(parsed) ? parsed : Array.isArray(parsed.messages) ? parsed.messages : [parsed];
    return uniqueTargets(fromRecords(records, parsed.channelId || parsed.channel_id || channelId));
  }
  return uniqueTargets(input.split(/[\s,;]+/).filter(Boolean).map(value => {
    const ref = parseMessageReference(value);
    if (!ref || (ref.channelId && !/^(?:https?:\/\/)?(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/channels\/[^/\s]+\/\d+\/\d+\/?$/i.test(value))) {
      throw new Error(`Invalid message ID or link: ${value.slice(0, 80)}`);
    }
    return { channelId: ref.channelId || channelId, messageId: ref.messageId };
  }));
}

export async function importMessageIds(fileList, fallbackChannelId = '') {
  const files = [...(fileList || [])];
  const pathOf = file => String(file.webkitRelativePath || file.name).replace(/\\/g, '/');
  const folderOf = filePath => filePath.slice(0, Math.max(0, filePath.lastIndexOf('/'))).toLowerCase();
  const channelByFolder = new Map();
  const targets = [];
  for (const file of files) {
    if (!/(?:^|\/)channel\.json$/i.test(pathOf(file))) continue;
    const channel = parseIdJson(await file.text());
    channelByFolder.set(folderOf(pathOf(file)), snowflake(channel.id, 'Channel ID'));
  }
  let importedFiles = 0;
  for (const file of files) {
    const filePath = pathOf(file);
    const name = filePath.split('/').at(-1);
    if (!/\.(json|csv|txt)$/i.test(name) || /^(?:index|channel|user)\.json$/i.test(name)) continue;
    if (file.webkitRelativePath && !/^messages?\.(json|csv)$/i.test(name)) continue;
    const folder = folderOf(filePath);
    const channelId = channelByFolder.get(folder) || folder.match(/(?:^|\/)c?(\d{15,22})$/)?.[1] || fallbackChannelId;
    const text = await file.text();
    try {
      if (/\.csv$/i.test(name)) {
        const [header = [], ...rows] = parseCsv(text);
        const normalize = value => value.trim().toLowerCase().replace(/[\s_]/g, '');
        const messageColumn = header.findIndex(value => ['id', 'messageid'].includes(normalize(value)));
        const channelColumn = header.findIndex(value => normalize(value) === 'channelid');
        if (messageColumn < 0) throw new Error('CSV needs an ID or Message ID column.');
        targets.push(...uniqueTargets(rows.map(row => ({ messageId: row[messageColumn], channelId: channelColumn < 0 ? channelId : row[channelColumn] }))));
      } else {
        targets.push(...parseMessageIds(text, channelId));
      }
      importedFiles++;
    } catch (error) { throw new Error(`${name}: ${error.message}`, { cause: error }); }
  }
  if (!importedFiles) throw new Error('No message ID files found. Choose message JSON/CSV files or an extracted data package folder.');
  return uniqueTargets(targets);
}
