import type { Database } from 'bun:sqlite';
import { createHash, randomBytes } from 'node:crypto';
import type { User } from '@kuroko/contracts/auth';

type Account = User & { password_hash: string };

export function createAccountStore(db: Database) {
  const findAccount = db.query<Account, [string]>(
    'SELECT id, username, password_hash FROM users WHERE username_key = ?',
  );
  const findPassword = db.query<{ password_hash: string }, [number]>('SELECT password_hash FROM users WHERE id = ?');
  const insertUser = db.query<User, [string, string, string]>(`
    INSERT INTO users (username, username_key, password_hash) VALUES (?, ?, ?)
    ON CONFLICT (username_key) DO NOTHING RETURNING id, username
  `);
  const findSessionUser = db.query<User, [string, number]>(`
    SELECT users.id, users.username FROM sessions JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > ?
  `);
  const deleteSession = db.query('DELETE FROM sessions WHERE token_hash = ?');
  const issueSession = db.transaction((account: Account, expiresAt: number, previousHash?: string) => {
    // Password verification is asynchronous. Check the hash again before issuing a session.
    if (findPassword.get(account.id)?.password_hash !== account.password_hash) {
      return;
    }
    const token = randomBytes(32).toString('base64url');
    db.run('DELETE FROM sessions WHERE expires_at <= ?', [Date.now()]);
    if (previousHash) {
      deleteSession.run(previousHash);
    }
    db.run('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)', [
      hashToken(token), account.id, expiresAt,
    ]);
    return token;
  });

  function verifiedSessionStillActive(userId: number, tokenHash: string, passwordHash: string) {
    return findSessionUser.get(tokenHash, Date.now())?.id === userId &&
      findPassword.get(userId)?.password_hash === passwordHash;
  }

  const changePassword = db.transaction((userId: number, tokenHash: string, oldHash: string, newHash: string) => {
    if (!verifiedSessionStillActive(userId, tokenHash, oldHash)) {
      return false;
    }
    db.run('UPDATE users SET password_hash = ? WHERE id = ?', [newHash, userId]);
    db.run('DELETE FROM sessions WHERE user_id = ?', [userId]);
    return true;
  });

  const deleteAccount = db.transaction((userId: number, tokenHash: string, passwordHash: string) => {
    if (!verifiedSessionStillActive(userId, tokenHash, passwordHash)) {
      return false;
    }
    db.run('DELETE FROM users WHERE id = ?', [userId]);
    return true;
  });

  return {
    findAccount: (usernameKey: string) => findAccount.get(usernameKey),
    findPassword: (userId: number) => findPassword.get(userId),
    createUser: (name: string, passwordHash: string) => insertUser.get(name, name.toLowerCase(), passwordHash),
    findSessionUser: (tokenHash: string) => findSessionUser.get(tokenHash, Date.now()),
    deleteSession: (tokenHash: string) => deleteSession.run(tokenHash),
    issueSession: issueSession.immediate,
    changePassword: changePassword.immediate,
    deleteAccount: deleteAccount.immediate,
  };
}

export function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}
