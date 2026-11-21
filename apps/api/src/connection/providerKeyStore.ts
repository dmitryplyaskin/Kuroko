import type { Database } from 'bun:sqlite';
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import type { Provider, ProviderKey } from '@kuroko/contracts/connectionSettings';

const nonceLength = 12;
const tagLength = 16;

export function createProviderKeyStore(db: Database, vaultKey: Buffer) {
  const list = db.query<ProviderKey, [number]>(`
    SELECT provider_keys.id, secrets.name, provider_keys.provider
    FROM provider_keys JOIN secrets ON secrets.id = provider_keys.secret_id
    WHERE secrets.user_id = ? ORDER BY secrets.name, provider_keys.id
  `);
  const scope = `provider_keys.id = ? AND provider_keys.provider = ? AND secrets.user_id = ?`;
  const find = db.query<{ id: string; encrypted_value: Uint8Array }, [string, Provider, number]>(`
    SELECT secrets.id, secrets.encrypted_value
    FROM provider_keys JOIN secrets ON secrets.id = provider_keys.secret_id WHERE ${scope}
  `);
  const exists = db.query<{ id: string }, [string, Provider, number]>(`
    SELECT provider_keys.id FROM provider_keys JOIN secrets ON secrets.id = provider_keys.secret_id WHERE ${scope}
  `);
  const findByName = db.query<{ id: string }, [Provider, number, string]>(`
    SELECT provider_keys.id FROM provider_keys JOIN secrets ON secrets.id = provider_keys.secret_id
    WHERE provider_keys.provider = ? AND secrets.user_id = ? AND secrets.name = ?
  `);
  const insert = db.query(`
    INSERT INTO secrets (id, user_id, name, encrypted_value, created_at) VALUES (?, ?, ?, ?, ?)
  `);
  const insertLink = db.query('INSERT INTO provider_keys (id, secret_id, provider) VALUES (?, ?, ?)');
  const removeLink = db.query<{ secret_id: string }, [string, Provider, number]>(`
    DELETE FROM provider_keys WHERE id = ? AND provider = ?
      AND EXISTS (SELECT 1 FROM secrets WHERE id = provider_keys.secret_id AND user_id = ?) RETURNING secret_id
  `);
  const removeUnlinked = db.query(`
    DELETE FROM secrets WHERE id = ? AND NOT EXISTS (SELECT 1 FROM provider_keys WHERE secret_id = secrets.id)
  `);

  const create = db.transaction((userId: number, provider: Provider, name: string, value: string): ProviderKey | null => {
    if (findByName.get(provider, userId, name)) return null;
    const id = randomUUID();
    insert.run(id, userId, name, encrypt(vaultKey, userId, id, value), Date.now());
    insertLink.run(id, id, provider);
    return { id, name, provider };
  });

  const remove = db.transaction((userId: number, provider: Provider, id: string) => {
    const deleted = removeLink.get(id, provider, userId);
    if (!deleted) return false;
    removeUnlinked.run(deleted.secret_id);
    return true;
  });

  return {
    list: (userId: number) => list.all(userId),
    has: (userId: number, provider: Provider, id: string) => exists.get(id, provider, userId) !== null,
    getForProvider(userId: number, provider: Provider, id: string) {
      const secret = find.get(id, provider, userId);
      return secret && decrypt(vaultKey, userId, secret.id, secret.encrypted_value);
    },
    create: create.immediate,
    remove: remove.immediate,
  };
}

export type ProviderKeyStore = ReturnType<typeof createProviderKeyStore>;

function encrypt(key: Buffer, userId: number, id: string, value: string) {
  const nonce = randomBytes(nonceLength);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.from(`${userId}:${id}`));
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]);
}

function decrypt(key: Buffer, userId: number, id: string, encrypted: Uint8Array) {
  const nonce = encrypted.subarray(0, nonceLength);
  const tag = encrypted.subarray(nonceLength, nonceLength + tagLength);
  const ciphertext = encrypted.subarray(nonceLength + tagLength);
  const decipher = createDecipheriv('aes-256-gcm', key, nonce, { authTagLength: tagLength });
  decipher.setAAD(Buffer.from(`${userId}:${id}`));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
