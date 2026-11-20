import { mkdirSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { createApp } from './app';
import { openDatabase } from './database';
import { loadVaultKey } from './vault-key';

const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535');
}

const host = process.env.HOST || '127.0.0.1';
const secureCookie = process.env.COOKIE_SECURE === '1';
const webDir = process.argv.includes('--serve-web') ? join(import.meta.dir, 'web') : undefined;
if (webDir && !(await Bun.file(join(webDir, 'index.html')).exists())) {
  throw new Error('Frontend build missing. Run bun run build first.');
}

const dataDir = resolve(process.env.DATA_DIR || 'data');
mkdirSync(dataDir, { recursive: true, mode: 0o700 });
if (webDir) {
  const dataFromWebDir = relative(realpathSync(webDir), realpathSync(dataDir));
  if (dataFromWebDir !== '..' && !dataFromWebDir.startsWith(`..${sep}`) && !isAbsolute(dataFromWebDir)) {
    throw new Error('DATA_DIR must be outside the public web directory');
  }
}
const dbPath = join(dataDir, 'kuroko.sqlite');
const vaultKey = loadVaultKey(dataDir, dbPath, process.env.VAULT_KEY);
const db = openDatabase(dbPath, vaultKey);

createApp({ db, vaultKey, secureCookie, trustProxy: process.env.TRUST_PROXY, webDir }).listen(port, host, (error) => {
  if (error) {
    console.error(error);
    process.exit(1);
  }

  const displayHost = host.includes(':') ? `[${host}]` : host;
  console.log(`Kuroko ${webDir ? 'app' : 'API'} listening on http://${displayHost}:${port}`);
});
