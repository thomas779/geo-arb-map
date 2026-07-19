import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const wranglerEntry = fileURLToPath(
  new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url),
);
const distIndex = fileURLToPath(new URL('../dist/index.html', import.meta.url));
const productionUrl = 'https://atlas.thomphreys.com/';

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

async function deploy(): Promise<{ exitCode: number; output: string }> {
  const child = Bun.spawn(
    [node!, wranglerEntry, 'deploy', '--config', 'wrangler.web.jsonc'],
    {
      cwd: repoRoot,
      stdin: 'inherit',
      stdout: 'pipe',
      stderr: 'pipe',
    },
  );
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  const output = `${stdout}${stderr}`;
  process.stdout.write(output);
  return { exitCode, output };
}

let result = await deploy();
if (result.exitCode === 0 && !result.output.includes('Current Version ID:')) {
  console.warn('Wrangler uploaded assets without activating a version; retrying deployment once.');
  result = await deploy();
}

if (result.exitCode !== 0 || !result.output.includes('Current Version ID:')) {
  console.error('Cloudflare did not confirm an active Worker version.');
  process.exit(result.exitCode || 1);
}

const expectedAssets = (await Bun.file(distIndex).text())
  .match(/assets\/index-[^"' ]+\.(?:js|css)/g) ?? [];
let live = false;
for (let attempt = 0; attempt < 3; attempt += 1) {
  const response = await fetch(`${productionUrl}?deploy-check=${Date.now()}`, {
    headers: { 'cache-control': 'no-cache' },
  });
  const html = await response.text();
  live = response.ok && expectedAssets.every(asset => html.includes(asset));
  if (live) break;
  await Bun.sleep(1_000);
}

if (!live) {
  console.error(`Deployment completed, but ${productionUrl} is not serving the current asset hashes.`);
  process.exit(1);
}

console.log(`${productionUrl} is serving ${expectedAssets.join(' and ')}.`);
