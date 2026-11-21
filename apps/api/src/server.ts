import { CodedError } from '@kuroko/contracts/errors';
import { mkdirSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { createApp } from './app';
import { openDatabase } from './storage/database';
import { loadVaultKey } from './storage/vaultKey';

const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new CodedError('config_port_invalid', { variable: 'PORT', min: 1, max: 65535 });
}

const host = process.env.HOST || '127.0.0.1';
const secureCookie = process.env.COOKIE_SECURE === '1';
const webDir = process.argv.includes('--serve-web') ? join(import.meta.dir, 'web') : undefined;
if (webDir && !(await Bun.file(join(webDir, 'index.html')).exists())) {
  throw new CodedError('web_build_missing', { webDir });
}

const dataDir = resolve(process.env.DATA_DIR || 'data');
mkdirSync(dataDir, { recursive: true, mode: 0o700 });
if (webDir) {
  const dataFromWebDir = relative(realpathSync(webDir), realpathSync(dataDir));
  if (dataFromWebDir !== '..' && !dataFromWebDir.startsWith(`..${sep}`) && !isAbsolute(dataFromWebDir)) {
    throw new CodedError('config_data_dir_public', { variable: 'DATA_DIR' });
  }
}
const dbPath = join(dataDir, 'kuroko.sqlite');
const vaultKey = loadVaultKey(dataDir, dbPath, process.env.VAULT_KEY);
const db = openDatabase(dbPath, vaultKey);

createApp({ db, vaultKey, secureCookie, trustProxy: process.env.TRUST_PROXY, webDir }).listen(port, host, (error) => {
  if (error) {
    console.error('server_listen_failed', error);
    process.exit(1);
  }

  const displayHost = host.includes(':') ? `[${host}]` : host;
  console.log('server_listening', { mode: webDir ? 'app' : 'api', url: `http://${displayHost}:${port}` });
});
