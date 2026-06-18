import fs from 'node:fs/promises';
import path from 'node:path';
import { isSupportedAttachment } from '../../shared/validators.mjs';

export async function extractFileText(filePath) {
  if (!filePath) throw new Error('Missing file path.');
  if (!isSupportedAttachment(filePath)) {
    throw new Error(`Unsupported file type: ${path.extname(filePath) || 'unknown'}. Supported: PDF, DOCX, TXT.`);
  }

  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.txt') {
    return await fs.readFile(filePath, 'utf8');
  }
  if (ext === '.docx') {
    return await extractDocx(filePath);
  }
  if (ext === '.pdf') {
    return await extractPdf(filePath);
  }
  throw new Error(`Unsupported file type: ${ext}`);
}

export async function extractFiles(filePaths = []) {
  const results = [];
  for (const filePath of filePaths) {
    const text = await extractFileText(filePath);
    results.push({
      name: path.basename(filePath),
      path: filePath,
      text,
      characters: text.length
    });
  }
  return results;
}

export function prependAttachmentsToMessage({ message, extractedFiles = [] }) {
  const attachmentBlocks = extractedFiles.map((file, index) => {
    return `[Uploaded file ${index + 1}: ${file.name}]\n${file.text}`;
  });

  if (!attachmentBlocks.length) return String(message || '');
  return `${attachmentBlocks.join('\n\n')}\n\n[User message]\n${String(message || '')}`.trim();
}

async function extractDocx(filePath) {
  const mammothModule = await import('mammoth');
  const mammoth = mammothModule.default || mammothModule;
  const result = await mammoth.extractRawText({ path: filePath });
  return result.value || '';
}

async function extractPdf(filePath) {
  const buffer = await fs.readFile(filePath);
  const pdfModule = await import('pdf-parse');

  if (typeof pdfModule.PDFParse === 'function') {
    const parser = new pdfModule.PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      return result?.text || '';
    } finally {
      if (typeof parser.destroy === 'function') {
        await parser.destroy();
      }
    }
  }

  const legacyParser = pdfModule.default || pdfModule;
  if (typeof legacyParser === 'function') {
    const result = await legacyParser(buffer);
    return result?.text || '';
  }

  throw new Error('Could not find a compatible pdf-parse API.');
}
