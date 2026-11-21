import { CodedError } from '@kuroko/contracts/errors';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, linkSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

function parseKey(value: string) {
  const key = Buffer.from(value, 'base64url');
  if (key.length !== 32 || key.toString('base64url') !== value) {
    throw new CodedError('vault_key_invalid');
  }
  return key;
}

export function loadVaultKey(dataDir: string, dbPath: string, configuredKey?: string) {
  if (configuredKey !== undefined) {
    return parseKey(configuredKey);
  }

  const keyPath = join(dataDir, 'vault.key');
  if (!existsSync(keyPath)) {
    if (existsSync(dbPath) && !existsSync(keyPath)) {
      throw new CodedError('vault_key_missing');
    }

    const temporaryPath = join(dataDir, `.vault-key-${randomUUID()}.tmp`);
    try {
      writeFileSync(temporaryPath, randomBytes(32).toString('base64url'), { mode: 0o600, flag: 'wx' });
      // Publish the complete key without overwriting a key created by another process.
      linkSync(temporaryPath, keyPath);
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) {
        throw error;
      }
    } finally {
      rmSync(temporaryPath, { force: true });
    }
  }

  return parseKey(readFileSync(keyPath, 'utf8').trim());
}
