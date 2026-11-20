import { join } from 'node:path';
import { createApp } from './app';

const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535');
}

const webDir = process.argv.includes('--serve-web') ? join(import.meta.dir, 'web') : undefined;
if (webDir && !(await Bun.file(join(webDir, 'index.html')).exists())) {
  throw new Error('Frontend build missing. Run bun run build first.');
}

createApp(webDir).listen(port, (error) => {
  if (error) {
    console.error(error);
    process.exit(1);
  }

  console.log(`Kuroko ${webDir ? 'app' : 'API'} listening on http://localhost:${port}`);
});
