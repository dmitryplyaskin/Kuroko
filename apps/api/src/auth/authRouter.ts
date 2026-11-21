import { randomBytes } from 'node:crypto';
import { Router, type CookieOptions, type Request, type RequestHandler, type Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import type { User } from '@kuroko/contracts/auth';
import { hashToken, type createAccountStore } from './accountStore';

const day = 24 * 60 * 60 * 1000;
const usernamePattern = /^[\p{L}\p{N}._-]{3,32}$/u;
const argon2id = { algorithm: 'argon2id', memoryCost: 65_536, timeCost: 2 } as const;
const signedOut = { error: 'Войдите в аккаунт.' };
const passwordLengthError = 'Пароль должен содержать от 12 до 128 символов.';

export function createAuthRouter(accounts: ReturnType<typeof createAccountStore>, secureCookie: boolean) {
  const router = Router();
  const cookieName = secureCookie ? '__Host-kuroko_session' : 'kuroko_session';
  const cookieOptions: CookieOptions = { httpOnly: true, sameSite: 'strict', secure: secureCookie, path: '/' };
  const fallbackHash = Bun.password.hashSync(randomBytes(32), argon2id);
  const limitAttempts = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Слишком много попыток. Попробуйте через несколько минут.' },
  });

  function sessionHash(request: Request) {
    const prefix = `${cookieName}=`;
    const token = request.headers.cookie?.split(/;\s*/)
      .find((part) => part.startsWith(prefix))?.slice(prefix.length);
    return token && /^[A-Za-z0-9_-]{43}$/.test(token) ? hashToken(token) : undefined;
  }

  const requireUser: RequestHandler = (request, response, next) => {
    const tokenHash = sessionHash(request);
    const user = tokenHash && accounts.findSessionUser(tokenHash);
    if (!user || !matchesAccount(request, user)) {
      response.status(401).json(signedOut);
      return;
    }

    response.locals.user = user;
    response.locals.sessionHash = tokenHash;
    next();
  };

  router.post('/register', limitAttempts, async (request, response) => {
    const { username, password } = request.body ?? {};
    const name = normalizeUsername(username);
    if (!name) {
      response.status(400).json({ error: 'Имя должно содержать от 3 до 32 букв, цифр или символов . _ -', field: 'username' });
      return;
    }
    if (!validPassword(password) || password.length < 12) {
      response.status(400).json({ error: passwordLengthError, field: 'password' });
      return;
    }

    const passwordHash = await Bun.password.hash(password, argon2id);
    const user = accounts.createUser(name, passwordHash);
    if (!user) {
      response.status(409).json({ error: 'Это имя уже занято.', field: 'username' });
      return;
    }

    response.status(201).json(user);
  });

  router.post('/login', limitAttempts, async (request, response) => {
    const { username, password, remember = false } = request.body ?? {};
    const name = normalizeUsername(username);
    const invalidCredentials = { error: 'Неверное имя пользователя или пароль.' };
    if (!name || !validPassword(password) || typeof remember !== 'boolean') {
      response.status(400).json(invalidCredentials);
      return;
    }

    const user = accounts.findAccount(name.toLowerCase());
    const valid = await Bun.password.verify(password, user?.password_hash ?? fallbackHash);
    if (!valid || !user) {
      response.status(401).json(invalidCredentials);
      return;
    }

    const duration = remember ? 30 * day : day;
    const token = accounts.issueSession(user, Date.now() + duration, sessionHash(request));
    if (!token) {
      response.status(401).json(invalidCredentials);
      return;
    }
    response.cookie(cookieName, token, remember ? { ...cookieOptions, maxAge: duration } : cookieOptions);
    response.json({ id: user.id, username: user.username });
  });

  router.get('/session', requireUser, (_request, response) => {
    response.json(response.locals.user);
  });

  async function confirmPassword(userId: number, currentPassword: unknown, response: Response) {
    const account = accounts.findPassword(userId);
    if (!account) {
      response.status(401).json(signedOut);
      return;
    }
    if (!validPassword(currentPassword) || !await Bun.password.verify(currentPassword, account.password_hash)) {
      response.status(400).json({ error: 'Проверьте текущий пароль и попробуйте ещё раз.', field: 'currentPassword' });
      return;
    }
    return account.password_hash;
  }

  router.put('/password', limitAttempts, requireUser, async (request, response) => {
    const { currentPassword, newPassword } = request.body ?? {};
    if (!validPassword(newPassword) || newPassword.length < 12) {
      response.status(400).json({ error: passwordLengthError, field: 'newPassword' });
      return;
    }

    const { id }: User = response.locals.user;
    const oldHash = await confirmPassword(id, currentPassword, response);
    if (!oldHash) {
      return;
    }
    if (newPassword === currentPassword) {
      response.status(400).json({ error: 'Выберите пароль, отличный от текущего.', field: 'newPassword' });
      return;
    }
    const newHash = await Bun.password.hash(newPassword, argon2id);
    if (!accounts.changePassword(id, response.locals.sessionHash, oldHash, newHash)) {
      response.status(401).json(signedOut);
      return;
    }
    response.clearCookie(cookieName, cookieOptions).status(204).end();
  });

  router.delete('/account', limitAttempts, requireUser, async (request, response) => {
    const { currentPassword, username } = request.body ?? {};
    const user: User = response.locals.user;
    if (username !== user.username) {
      response.status(400).json({ error: 'Введите имя аккаунта точно как указано.', field: 'username' });
      return;
    }

    const passwordHash = await confirmPassword(user.id, currentPassword, response);
    if (!passwordHash) {
      return;
    }
    if (!accounts.deleteAccount(user.id, response.locals.sessionHash, passwordHash)) {
      response.status(401).json(signedOut);
      return;
    }
    response.clearCookie(cookieName, cookieOptions).status(204).end();
  });

  router.post('/logout', (request, response) => {
    const tokenHash = sessionHash(request);
    if (tokenHash) {
      const user = accounts.findSessionUser(tokenHash);
      if (user && !matchesAccount(request, user)) {
        response.status(401).json(signedOut);
        return;
      }
      accounts.deleteSession(tokenHash);
    }
    response.clearCookie(cookieName, cookieOptions).status(204).end();
  });

  return { router, requireUser };
}

function matchesAccount(request: Request, user: User) {
  // A browser tab may still show an old account after another tab changes the session cookie.
  const expectedAccount = request.get('X-Kuroko-Account');
  return expectedAccount === undefined || expectedAccount === String(user.id);
}

function normalizeUsername(value: unknown) {
  if (typeof value !== 'string' || value.length > 128) {
    return null;
  }
  const username = value.trim().normalize('NFKC');
  return usernamePattern.test(username) ? username : null;
}

function validPassword(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 128 && value.isWellFormed();
}
