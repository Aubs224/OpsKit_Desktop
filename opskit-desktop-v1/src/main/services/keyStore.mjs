import fs from 'node:fs/promises';
import path from 'node:path';
import { app, safeStorage } from 'electron';
import { APP_SERVICE_NAME, PROVIDERS } from '../../shared/defaults.mjs';

const FALLBACK_ENV = 'OPSKIT_ALLOW_SAFESTORAGE_FALLBACK';

let cachedKeytar;
let cachedLoadError;

export async function getKeyStoreStatus() {
  const keytar = await loadKeytar().catch((error) => {
    cachedLoadError = error;
    return null;
  });

  if (keytar) {
    return { backend: 'keytar', secure: true, fallback: false, message: 'Using OS keychain through keytar.' };
  }

  if (allowSafeStorageFallback() && safeStorage.isEncryptionAvailable()) {
    return {
      backend: 'safeStorage',
      secure: true,
      fallback: true,
      message: 'Using Electron safeStorage fallback because keytar is unavailable.'
    };
  }

  return {
    backend: 'unavailable',
    secure: false,
    fallback: false,
    message: `Keychain unavailable. Install keytar successfully, or set ${FALLBACK_ENV}=1 to allow encrypted safeStorage fallback. ${cachedLoadError?.message || ''}`.trim()
  };
}

export async function setApiKey(provider, apiKey) {
  assertProvider(provider);
  const key = String(apiKey || '').trim();
  if (!key) throw new Error('API key cannot be empty.');
  const backend = await activeBackend();
  await backend.set(accountFor(provider), key);
}

export async function getApiKey(provider) {
  assertProvider(provider);
  const backend = await activeBackend();
  return await backend.get(accountFor(provider));
}

export async function deleteApiKey(provider) {
  assertProvider(provider);
  const backend = await activeBackend();
  await backend.delete(accountFor(provider));
}

export async function getApiKeyPresence() {
  const status = await getKeyStoreStatus();
  const result = { status, providers: {} };
  for (const provider of [PROVIDERS.COHERE, PROVIDERS.CLAUDE]) {
    try {
      result.providers[provider] = Boolean(await getApiKey(provider));
    } catch {
      result.providers[provider] = false;
    }
  }
  return result;
}

async function activeBackend() {
  const keytar = await loadKeytar().catch((error) => {
    cachedLoadError = error;
    return null;
  });
  if (keytar) {
    return {
      async set(account, secret) {
        await keytar.setPassword(APP_SERVICE_NAME, account, secret);
      },
      async get(account) {
        return await keytar.getPassword(APP_SERVICE_NAME, account);
      },
      async delete(account) {
        if (typeof keytar.deletePassword === 'function') {
          await keytar.deletePassword(APP_SERVICE_NAME, account);
        }
      }
    };
  }

  if (allowSafeStorageFallback() && safeStorage.isEncryptionAvailable()) {
    return safeStorageBackend();
  }

  throw new Error(`No secure key store available. Install keytar successfully, or set ${FALLBACK_ENV}=1 to allow Electron safeStorage fallback.`);
}

async function loadKeytar() {
  if (cachedKeytar) return cachedKeytar;
  const errors = [];
  for (const packageName of ['@github/keytar', 'keytar']) {
    try {
      const module = await import(packageName);
      cachedKeytar = module.default || module;
      if (typeof cachedKeytar.getPassword !== 'function') {
        throw new Error(`${packageName} did not expose getPassword()`);
      }
      return cachedKeytar;
    } catch (error) {
      errors.push(`${packageName}: ${error.message}`);
    }
  }
  throw new Error(errors.join(' | '));
}

function safeStorageBackend() {
  return {
    async set(account, secret) {
      const store = await readFallbackStore();
      store[account] = safeStorage.encryptString(secret).toString('base64');
      await writeFallbackStore(store);
    },
    async get(account) {
      const store = await readFallbackStore();
      const encrypted = store[account];
      if (!encrypted) return null;
      return safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
    },
    async delete(account) {
      const store = await readFallbackStore();
      delete store[account];
      await writeFallbackStore(store);
    }
  };
}

async function readFallbackStore() {
  try {
    return JSON.parse(await fs.readFile(fallbackPath(), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
}

async function writeFallbackStore(data) {
  await fs.mkdir(path.dirname(fallbackPath()), { recursive: true });
  await fs.writeFile(fallbackPath(), JSON.stringify(data, null, 2), 'utf8');
}

function fallbackPath() {
  return path.join(app.getPath('userData'), 'secure-keys.json');
}

function accountFor(provider) {
  return `provider:${provider}`;
}

function assertProvider(provider) {
  if (![PROVIDERS.COHERE, PROVIDERS.CLAUDE].includes(provider)) {
    throw new Error(`Unsupported provider: ${provider}`);
  }
}

function allowSafeStorageFallback() {
  return process.env[FALLBACK_ENV] === '1';
}
