/**
 * Runs the user's Playwright booking script with COURT_COUNT from env.
 * Edit scripts/book-courts.mjs to implement your site-specific booking flow.
 */
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const courtCount = parseInt(process.env.COURT_COUNT || '1', 10) || 1;

const scriptPath = join(__dirname, '..', 'scripts', 'book-courts.mjs');

console.log(`Running booking script with COURT_COUNT=${courtCount}`);

const child = spawn('node', [scriptPath], {
    env: { ...process.env, COURT_COUNT: String(courtCount) },
    stdio: 'inherit',
    cwd: join(__dirname, '..'),
  }
);

child.on('close', (code) => {
  process.exit(code ?? 0);
});
