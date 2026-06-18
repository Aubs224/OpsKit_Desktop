import fs from 'node:fs/promises';
import path from 'node:path';
import { buildSystemPrompt } from '../defaultSystemPrompt.mjs';
import { formatDateYYYYMMDD } from './dateUtils.mjs';

export async function assembleContext({ settings, sessionSlug, memoryFiles = [], history = [], userMessage }) {
  if (!settings?.quickSetupPath) {
    throw new Error('Quick Setup path is not configured.');
  }

  const quickSetupText = await fs.readFile(settings.quickSetupPath, 'utf8');
  const documents = [
    {
      title: 'OpsKit_Quick_Setup.txt',
      source: settings.quickSetupPath,
      layer: 1,
      text: quickSetupText
    },
    ...memoryFiles.map((file) => ({
      title: file.title || file.fileName || path.basename(file.path || 'memory.txt'),
      source: file.path || file.source || 'opskit_memory',
      layer: 2,
      text: file.text || ''
    }))
  ];

  const system = buildSystemPrompt({
    currentDate: formatDateYYYYMMDD(new Date()),
    sessionSlug
  });

  return {
    system,
    documents,
    history: normalizeHistory(history),
    userMessage: String(userMessage || '')
  };
}

export function normalizeHistory(history = []) {
  return history
    .filter((item) => item && (item.role === 'user' || item.role === 'assistant'))
    .map((item) => ({ role: item.role, content: String(item.content || '') }));
}

export function documentsAsCohereDocuments(documents = []) {
  // Cohere Chat V2 accepts documents as strings or document objects. Strings keep this
  // adapter resilient across SDK/API document-object shape changes while preserving order.
  return documents.map((doc, index) => {
    const title = doc.title || `document-${index}`;
    const source = doc.source || 'local';
    const layer = doc.layer || index;
    return `# ${title}\nLayer: ${layer}\nSource: ${source}\n\n${doc.text || ''}`;
  });
}

export function documentsAsSystemAppendix(documents = []) {
  if (!documents.length) return '';
  const chunks = documents.map((doc, index) => {
    const title = doc.title || `document-${index}`;
    const source = doc.source || 'local';
    const layer = doc.layer || index;
    return `<opskit_document index="${index}" layer="${layer}" title="${escapeXmlAttr(title)}" source="${escapeXmlAttr(source)}">\n${doc.text || ''}\n</opskit_document>`;
  });
  return `\n\nGrounding documents follow. Layer 1 appears first and is authoritative for OpsKit grammar. Layer 2 memory files follow.\n\n${chunks.join('\n\n')}`;
}

function escapeXmlAttr(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}
