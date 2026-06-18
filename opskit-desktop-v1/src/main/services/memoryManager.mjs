import fs from 'node:fs/promises';
import path from 'node:path';
import { RECEIPT_GLYPH } from '../../shared/defaults.mjs';
import { formatDateYYYYMMDD } from './dateUtils.mjs';

const DATE_PREFIX = /^(\d{4}-\d{2}-\d{2})_/;
const SESSION_MEMORY_FILE = /^(\d{4}-\d{2}-\d{2})_(.+)\.txt$/;

export function slugifySessionName(input) {
  const slug = String(input || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
  return slug || 'untitled-session';
}

export async function ensureMemoryDirectory(memoryDir) {
  if (!memoryDir) throw new Error('Memory directory is not configured.');
  await fs.mkdir(memoryDir, { recursive: true });
}

export function sessionFileName(sessionSlug, date = new Date()) {
  return `${formatDateYYYYMMDD(date)}_${slugifySessionName(sessionSlug)}.txt`;
}

export function sessionFilePath(memoryDir, sessionSlug, date = new Date()) {
  return path.join(memoryDir, sessionFileName(sessionSlug, date));
}

export function containsReceipt(text) {
  return String(text || '').includes(RECEIPT_GLYPH);
}

export function extractReceiptBlock(responseText) {
  const text = String(responseText || '');
  const glyphIndex = text.lastIndexOf(RECEIPT_GLYPH);
  if (glyphIndex === -1) return null;

  const dividerBefore = text.lastIndexOf('\n---', glyphIndex);
  const start = dividerBefore === -1 ? glyphIndex : dividerBefore + 1;
  const dividerAfter = text.indexOf('\n---', glyphIndex + RECEIPT_GLYPH.length);
  if (dividerAfter === -1) return text.slice(start).trim();
  return text.slice(start, dividerAfter + 4).trim();
}

function parseDateFromFileName(fileName) {
  const match = DATE_PREFIX.exec(fileName);
  return match ? match[1] : '0000-00-00';
}

export async function selectMemoryFiles({ memoryDir, sessionSlug, limit = 5 }) {
  await ensureMemoryDirectory(memoryDir);
  const slug = slugifySessionName(sessionSlug);
  const entries = await fs.readdir(memoryDir, { withFileTypes: true });

  const matched = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((fileName) => fileName !== '_index.txt')
    .filter((fileName) => fileName.toLowerCase().includes(slug.toLowerCase()))
    .sort((a, b) => parseDateFromFileName(b).localeCompare(parseDateFromFileName(a)))
    .slice(0, Math.max(0, Number(limit) || 0));

  const files = [];
  for (const fileName of matched) {
    const filePath = path.join(memoryDir, fileName);
    const text = await fs.readFile(filePath, 'utf8');
    files.push({
      title: fileName,
      fileName,
      path: filePath,
      date: parseDateFromFileName(fileName),
      text,
      layer: 2
    });
  }

  return files;
}


export async function listMemoryBackedSessions({ memoryDir, excludeSlugs = [] }) {
  await ensureMemoryDirectory(memoryDir);
  const excluded = new Set([...excludeSlugs].map((slug) => slugifySessionName(slug)));
  const entries = await fs.readdir(memoryDir, { withFileTypes: true });
  const bySlug = new Map();

  for (const entry of entries) {
    if (!entry.isFile() || entry.name === '_index.txt') continue;
    const match = SESSION_MEMORY_FILE.exec(entry.name);
    if (!match) continue;

    const [, date, rawSlug] = match;
    const slug = slugifySessionName(rawSlug.replace(/\.txt$/i, ''));
    if (!slug || excluded.has(slug)) continue;

    const current = bySlug.get(slug) || {
      id: `memory_${slug}`,
      slug,
      displayName: slug,
      source: 'memory',
      createdAt: `${date}T00:00:00.000Z`,
      updatedAt: `${date}T00:00:00.000Z`,
      historyTurns: 0,
      fileCount: 0,
      lastMessagePreview: 'Receipt memory only — open to continue from Layer 2 context'
    };

    current.fileCount += 1;
    if (date > current.updatedAt.slice(0, 10)) {
      current.updatedAt = `${date}T00:00:00.000Z`;
    }
    bySlug.set(slug, current);
  }

  return [...bySlug.values()].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

export async function appendReceiptIfPresent({ memoryDir, sessionSlug, responseText, date = new Date(), targetPath }) {
  if (!containsReceipt(responseText)) {
    return { saved: false, reason: 'no receipt glyph found' };
  }

  await ensureMemoryDirectory(memoryDir);
  const receiptTargetPath = targetPath || sessionFilePath(memoryDir, sessionSlug, date);
  await fs.mkdir(path.dirname(receiptTargetPath), { recursive: true });
  const receiptBlock = extractReceiptBlock(responseText) || String(responseText).trim();
  const payload = `\n\n${receiptBlock}\n`;
  await fs.appendFile(receiptTargetPath, payload, 'utf8');
  await updateIndex({ memoryDir, sessionSlug, sessionFile: receiptTargetPath, date });

  return { saved: true, path: receiptTargetPath, bytes: Buffer.byteLength(payload, 'utf8') };
}

export async function updateIndex({ memoryDir, sessionSlug, sessionFile, date = new Date() }) {
  const indexPath = path.join(memoryDir, '_index.txt');
  const line = `${formatDateYYYYMMDD(date)} | ${slugifySessionName(sessionSlug)} | ${path.basename(sessionFile)}`;
  let existing = '';
  try {
    existing = await fs.readFile(indexPath, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const lines = existing
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((oldLine) => !oldLine.includes(`| ${slugifySessionName(sessionSlug)} |`));
  lines.unshift(line);
  await fs.writeFile(indexPath, `${lines.join('\n')}\n`, 'utf8');
}
