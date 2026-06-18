import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { slugifySessionName } from './memoryManager.mjs';

const SESSION_FILE_VERSION = 1;
const SESSION_ID_PATTERN = /^[a-zA-Z0-9._-]+$/;

export function sessionHistoryDirectory(userDataPath) {
  if (!userDataPath) throw new Error('User data path is required.');
  return path.join(userDataPath, 'sessions');
}

export const defaultSessionHistoryDir = sessionHistoryDirectory;

export async function ensureSessionHistoryDirectory(historyDir) {
  if (!historyDir) throw new Error('Session history directory is not configured.');
  await fs.mkdir(historyDir, { recursive: true });
}

export function createSessionRecord({
  name,
  slug,
  memoryFiles = [],
  settings = {},
  provider,
  source = 'transcript',
  sessionFilePath = '',
  now = new Date()
}) {
  const cleanSlug = slugifySessionName(slug || name);
  const createdAt = now.toISOString();
  return {
    version: SESSION_FILE_VERSION,
    id: createSessionId(cleanSlug, now),
    slug: cleanSlug,
    displayName: String(name || cleanSlug),
    source: source === 'memory' ? 'memory' : 'transcript',
    createdAt,
    updatedAt: createdAt,
    provider: provider || settings.activeProvider || '',
    activeProvider: provider || settings.activeProvider || '',
    cohereModel: settings.cohereModel || '',
    claudeModel: settings.claudeModel || '',
    sessionFilePath: String(sessionFilePath || ''),
    // Keep full text in the in-memory active session for context assembly. saveSessionRecord strips it on disk.
    memoryFiles: Array.isArray(memoryFiles) ? memoryFiles : [],
    messages: [],
    history: []
  };
}

export async function listSessionRecords(arg) {
  const historyDir = resolveSessionDir(arg);
  await ensureSessionHistoryDirectory(historyDir);
  const entries = await fs.readdir(historyDir, { withFileTypes: true });
  const sessions = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    try {
      const record = await readSessionFile(path.join(historyDir, entry.name));
      sessions.push(toSessionSummary(record, { includeMessages: false }));
    } catch {
      // A corrupt transcript should not break app boot or the sidebar.
    }
  }

  return sessions.sort(compareSessionsNewestFirst);
}

export async function loadSessionRecord(arg, idArg) {
  const historyDir = resolveSessionDir(arg);
  const id = typeof arg === 'object' && arg !== null ? arg.id : idArg;
  await ensureSessionHistoryDirectory(historyDir);
  return await readSessionFile(path.join(historyDir, `${safeSessionId(id)}.json`));
}

export async function saveSessionRecord(arg, recordArg) {
  const historyDir = resolveSessionDir(arg);
  const record = typeof arg === 'object' && arg !== null ? arg.session : recordArg;
  await ensureSessionHistoryDirectory(historyDir);
  const normalized = normalizeSessionRecord(record);
  const targetPath = path.join(historyDir, `${safeSessionId(normalized.id)}.json`);
  const tempPath = `${targetPath}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(serializeForDisk(normalized), null, 2)}\n`, 'utf8');
  await fs.rename(tempPath, targetPath);
  return normalized;
}

export function appendChatExchange(record, {
  userDisplayContent,
  userProviderContent,
  assistantContent,
  receipt,
  extractedFiles = [],
  now = new Date()
}) {
  const normalized = normalizeSessionRecord(record);
  const userCreatedAt = now.toISOString();
  const assistantCreatedAt = new Date().toISOString();
  const attachments = extractedFiles.map((file) => ({
    name: String(file.name || 'attachment'),
    characters: Number(file.characters || 0)
  }));

  normalized.messages.push({
    id: randomUUID(),
    role: 'user',
    content: String(userDisplayContent || ''),
    providerContent: String(userProviderContent || userDisplayContent || ''),
    createdAt: userCreatedAt,
    attachments
  });

  normalized.messages.push({
    id: randomUUID(),
    role: 'assistant',
    content: String(assistantContent || ''),
    createdAt: assistantCreatedAt,
    receipt: receipt ? {
      saved: Boolean(receipt.saved),
      path: receipt.path ? String(receipt.path) : undefined,
      bytes: Number(receipt.bytes || 0),
      reason: receipt.reason ? String(receipt.reason) : undefined
    } : undefined
  });

  normalized.history = messagesToHistory(normalized.messages);
  normalized.updatedAt = assistantCreatedAt;
  return normalized;
}

// Compatibility helper for older tests/call sites. New code should use appendChatExchange.
export function addTranscriptMessage(session, { role, content, createdAt = new Date().toISOString(), meta = {} }) {
  if (!session) throw new Error('No session is active.');
  if (role !== 'user' && role !== 'assistant') throw new Error(`Unsupported transcript role: ${role}`);
  const message = {
    id: randomUUID(),
    role,
    content: String(meta.displayContent || content || ''),
    providerContent: role === 'user' ? String(content || '') : undefined,
    createdAt: validIsoOrNow(createdAt),
    attachments: Array.isArray(meta.attachments) ? meta.attachments : undefined,
    receipt: meta.receiptSaved !== undefined ? {
      saved: Boolean(meta.receiptSaved),
      path: meta.receiptPath ? String(meta.receiptPath) : undefined
    } : undefined,
    meta: sanitizeMeta(meta)
  };
  session.messages = normalizeMessages(session.messages || session.history || []);
  session.messages.push(message);
  session.history = messagesToHistory(session.messages);
  session.updatedAt = message.createdAt;
  return message;
}

export function providerHistoryFromMessages(messages = []) {
  return normalizeMessages(messages)
    .map((message) => ({
      role: message.role,
      content: String(message.providerContent || message.content || '')
    }))
    .filter((message) => message.content.trim().length > 0);
}

export function toSessionSummary(record, { includeMessages = false } = {}) {
  const normalized = normalizeSessionRecord(record);
  const messages = normalizeMessages(normalized.messages);
  const lastMessage = [...messages].reverse().find((message) => message.content.trim());
  const summary = {
    id: normalized.id,
    slug: normalized.slug,
    displayName: normalized.displayName,
    source: normalized.source || 'transcript',
    provider: normalized.provider || normalized.activeProvider || '',
    activeProvider: normalized.activeProvider || normalized.provider || '',
    createdAt: normalized.createdAt,
    startedAt: normalized.createdAt,
    updatedAt: normalized.updatedAt,
    memoryFiles: summarizeMemoryFiles(normalized.memoryFiles),
    memoryFileCount: summarizeMemoryFiles(normalized.memoryFiles).length,
    historyTurns: messages.filter((message) => message.role === 'assistant').length,
    messageCount: messages.length,
    sessionFilePath: normalized.sessionFilePath,
    lastMessagePreview: lastMessage ? previewText(lastMessage.content) : 'No messages yet'
  };

  if (includeMessages) {
    summary.messages = messages.map((message) => ({ ...message }));
    summary.history = messagesToHistory(messages);
  }

  return summary;
}

export const sessionListItem = toSessionSummary;

export function compareSessionsNewestFirst(a, b) {
  return String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')) || String(a.displayName || '').localeCompare(String(b.displayName || ''));
}

function resolveSessionDir(arg) {
  if (typeof arg === 'string') return arg;
  if (arg && typeof arg === 'object' && typeof arg.sessionDir === 'string') return arg.sessionDir;
  throw new Error('Session directory is required.');
}

async function readSessionFile(filePath) {
  const raw = JSON.parse(await fs.readFile(filePath, 'utf8'));
  return normalizeSessionRecord(raw);
}

function normalizeSessionRecord(input = {}) {
  const record = input && typeof input === 'object' ? input : {};
  const slug = slugifySessionName(record.slug || record.displayName || 'untitled-session');
  const createdAt = validIsoOrNow(record.createdAt || record.startedAt);
  const updatedAt = validIsoOrNow(record.updatedAt || createdAt);
  const messages = normalizeMessages(record.messages || record.history || []);

  return {
    version: SESSION_FILE_VERSION,
    id: safeSessionId(record.id || createSessionId(slug, new Date(createdAt))),
    slug,
    displayName: String(record.displayName || slug),
    source: record.source === 'memory' ? 'memory' : 'transcript',
    createdAt,
    updatedAt,
    provider: String(record.provider || record.activeProvider || ''),
    activeProvider: String(record.activeProvider || record.provider || ''),
    cohereModel: String(record.cohereModel || ''),
    claudeModel: String(record.claudeModel || ''),
    sessionFilePath: String(record.sessionFilePath || ''),
    memoryFiles: Array.isArray(record.memoryFiles) ? record.memoryFiles : [],
    messages,
    history: messagesToHistory(messages)
  };
}

function normalizeMessages(messages = []) {
  if (!Array.isArray(messages)) return [];
  return messages
    .filter((message) => message && (message.role === 'user' || message.role === 'assistant'))
    .map((message) => {
      const meta = sanitizeMeta(message.meta || {});
      const providerContent = message.providerContent || (message.role === 'user' ? message.content : '');
      return {
        id: String(message.id || randomUUID()),
        role: message.role,
        content: String(meta.displayContent || message.displayContent || message.content || ''),
        providerContent: providerContent ? String(providerContent) : undefined,
        createdAt: validIsoOrNow(message.createdAt || message.at),
        attachments: Array.isArray(message.attachments || meta.attachments)
          ? (message.attachments || meta.attachments).map((file) => ({
              name: String(file.name || 'attachment'),
              characters: Number(file.characters || 0)
            }))
          : undefined,
        receipt: message.receipt ? {
          saved: Boolean(message.receipt.saved),
          path: message.receipt.path ? String(message.receipt.path) : undefined,
          bytes: Number(message.receipt.bytes || 0),
          reason: message.receipt.reason ? String(message.receipt.reason) : undefined
        } : undefined
      };
    });
}

function messagesToHistory(messages = []) {
  return normalizeMessages(messages).map((message) => ({
    role: message.role,
    content: String(message.providerContent || message.content || ''),
    displayContent: String(message.content || ''),
    at: message.createdAt,
    createdAt: message.createdAt,
    attachments: message.attachments || [],
    receipt: message.receipt
  }));
}

function serializeForDisk(record) {
  const normalized = normalizeSessionRecord(record);
  return {
    version: SESSION_FILE_VERSION,
    id: normalized.id,
    slug: normalized.slug,
    displayName: normalized.displayName,
    source: normalized.source,
    createdAt: normalized.createdAt,
    updatedAt: normalized.updatedAt,
    provider: normalized.provider || normalized.activeProvider || '',
    activeProvider: normalized.activeProvider || normalized.provider || '',
    cohereModel: normalized.cohereModel || '',
    claudeModel: normalized.claudeModel || '',
    sessionFilePath: normalized.sessionFilePath || '',
    memoryFiles: summarizeMemoryFiles(normalized.memoryFiles),
    messages: normalizeMessages(normalized.messages)
  };
}

function summarizeMemoryFiles(memoryFiles = []) {
  return (Array.isArray(memoryFiles) ? memoryFiles : []).map((file) => ({
    title: String(file.title || file.fileName || path.basename(file.path || 'memory.txt')),
    fileName: file.fileName ? String(file.fileName) : undefined,
    path: file.path ? String(file.path) : undefined,
    date: file.date ? String(file.date) : undefined,
    layer: Number(file.layer || 2)
  }));
}

function sanitizeMeta(meta = {}) {
  const clean = {};
  for (const [key, value] of Object.entries(meta || {})) {
    if (value === null || value === undefined) continue;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      clean[key] = value;
    } else if (Array.isArray(value)) {
      clean[key] = value.map((item) => (item && typeof item === 'object' ? { ...item } : item));
    } else if (typeof value === 'object') {
      clean[key] = { ...value };
    }
  }
  return clean;
}

function createSessionId(slug, date) {
  const stamp = date.toISOString().replace(/[^0-9]/g, '').slice(0, 14);
  return `${stamp}_${slugifySessionName(slug)}_${randomUUID().slice(0, 8)}`;
}

function safeSessionId(value) {
  const text = String(value || '').trim();
  if (!text || !SESSION_ID_PATTERN.test(text)) throw new Error('Invalid session id.');
  return text;
}

function validIsoOrNow(value) {
  const date = new Date(value || Date.now());
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function previewText(value, limit = 140) {
  const compact = String(value || '').replace(/\s+/g, ' ').trim();
  return compact.length > limit ? `${compact.slice(0, limit - 1)}…` : compact;
}
