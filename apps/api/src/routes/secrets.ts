import type { Database } from 'bun:sqlite';
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { Router } from 'express';

type Summary = { id: string; name: string };
type SecretRow = Summary & { encrypted_value: Uint8Array };

const nonceLength = 12;
const tagLength = 16;

export function createSecretsRouter(db: Database, vaultKey: Buffer) {
  const router = Router();
  const list = db.query<Summary, [number]>(`
    SELECT id, name FROM secrets WHERE user_id = ? ORDER BY created_at DESC, id
  `);
  const find = db.query<SecretRow, [number, string]>(`
    SELECT id, name, encrypted_value FROM secrets WHERE user_id = ? AND id = ?
  `);
  const insert = db.query<Summary, [string, number, string, Buffer, number]>(`
    INSERT INTO secrets (id, user_id, name, encrypted_value, created_at) VALUES (?, ?, ?, ?, ?)
    RETURNING id, name
  `);
  const update = db.query<Summary, [string, Buffer, number, string]>(`
    UPDATE secrets SET name = ?, encrypted_value = ? WHERE user_id = ? AND id = ? RETURNING id, name
  `);
  const remove = db.query('DELETE FROM secrets WHERE user_id = ? AND id = ?');
  const notFound = { error: 'Секрет не найден.' };
  const invalidFields = { error: 'Укажите название до 120 символов и значение до 16 384 символов.' };

  router.get('/', (_request, response) => {
    response.json(list.all(response.locals.user.id));
  });

  router.get('/:id', (request, response) => {
    const userId: number = response.locals.user.id;
    const secret = find.get(userId, request.params.id);
    if (!secret) {
      response.status(404).json(notFound);
      return;
    }

    const { id, name, encrypted_value } = secret;
    response.json({ id, name, value: decrypt(vaultKey, userId, id, encrypted_value) });
  });

  router.post('/', (request, response) => {
    const fields = readFields(request.body);
    if (!fields) {
      response.status(400).json(invalidFields);
      return;
    }

    const id = randomUUID();
    const userId: number = response.locals.user.id;
    const encrypted = encrypt(vaultKey, userId, id, fields.value);
    response.status(201).json(insert.get(id, userId, fields.name, encrypted, Date.now()));
  });

  router.put('/:id', (request, response) => {
    const fields = readFields(request.body);
    if (!fields) {
      response.status(400).json(invalidFields);
      return;
    }

    const userId: number = response.locals.user.id;
    const id = request.params.id;
    const updated = update.get(fields.name, encrypt(vaultKey, userId, id, fields.value), userId, id);
    if (!updated) {
      response.status(404).json(notFound);
      return;
    }

    response.json(updated);
  });

  router.delete('/:id', (request, response) => {
    const { changes } = remove.run(response.locals.user.id, request.params.id);
    if (changes === 0) {
      response.status(404).json(notFound);
      return;
    }

    response.status(204).end();
  });

  return router;
}

function readFields(body: unknown) {
  if (typeof body !== 'object' || body === null || !('name' in body) || !('value' in body)) {
    return null;
  }
  const { name, value } = body;
  if (typeof name !== 'string' || typeof value !== 'string') {
    return null;
  }
  const trimmedName = name.trim();
  if (!trimmedName || trimmedName.length > 120 || !trimmedName.isWellFormed() ||
      value.length === 0 || value.length > 16_384 || !value.isWellFormed()) {
    return null;
  }
  return { name: trimmedName, value };
}

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
