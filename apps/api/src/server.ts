import { CodedError } from '@kuroko/contracts/errors';
import { spawn } from 'node:child_process';
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

  if (webDir && process.argv.includes('--open') && process.env.BROWSER !== 'none') {
    const browserHost = host === '0.0.0.0' ? '127.0.0.1' : host === '::' ? '[::1]' : displayHost;
    const url = `http://${browserHost}:${port}`;
    const command = process.platform === 'win32' ? 'rundll32.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
    const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
    const opener = spawn(command, args, { stdio: 'ignore', windowsHide: true });
    opener.once('error', (error) => console.warn('browser_open_failed', { url, error }));
    opener.once('exit', (code) => {
      if (code) console.warn('browser_open_failed', { url, code });
    });
    opener.unref();
  }
});
