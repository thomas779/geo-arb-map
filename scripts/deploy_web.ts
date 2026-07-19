import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const wranglerEntry = fileURLToPath(
  new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url),
);

async function findNode(): Promise<string | null> {
  const systemNode = Bun.which('node');
  if (systemNode) return systemNode;

  const runtimeRoot = `${process.env.HOME}/.cache/codex-runtimes`;
  if (!existsSync(runtimeRoot)) return null;

  const glob = new Bun.Glob('*/dependencies/node/bin/node');
  for await (const path of glob.scan({ cwd: runtimeRoot, absolute: true, onlyFiles: true })) {
    return path;
  }
  return null;
}

const node = await findNode();
if (!node) {
  console.error('Wrangler requires Node.js. Install Node 22+ and rerun bun run deploy:web.');
  process.exit(1);
}

const result = Bun.spawnSync(
  [node, wranglerEntry, 'deploy', '--config', 'wrangler.web.jsonc'],
  {
    cwd: repoRoot,
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  },
);

process.exit(result.exitCode);
