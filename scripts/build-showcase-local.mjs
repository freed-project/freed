import { THEME_DEFINITIONS } from "@freed/shared/themes";
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile, rename, copyFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const themes = THEME_DEFINITIONS.map(theme => theme.id);
const args = process.argv.slice(2);
const value = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
if (args.includes('--help')) {
  console.log(`Local showcase workflow (run with the pinned Node toolchain):
  node scripts/build-showcase-local.mjs --theme midas --url http://localhost:1446
  node scripts/build-showcase-local.mjs --theme midas --encode-only --duration 2.4
  node scripts/build-showcase-local.mjs --serve --port 4186
  node scripts/build-showcase-local.mjs --all --url http://localhost:1446

Default: one Midas 1920x1280 quality-90 animated WebP, six ordered screens at three seconds each, desktop 120%, mobile 100%.
--all explicitly captures every theme. --encode-only reuses existing frames.
Each encoding retains an immutable local revision. Review at the served URL.
--desktop-only recaptures desktop while retaining matching mobile frames.
--compare adds lossless WebP and APNG alternatives.
--output overrides output/showcase. --duration accepts 0.5 to 10 seconds.
Start the PWA with VITE_FREED_DEMO=1 scripts/worktree-preview.sh pwa before capture. No publication.`);
  process.exit(0);
}
const output = path.resolve(root, value('--output', 'output/showcase'));
const duration = Number(value('--duration', '3'));
if (!Number.isFinite(duration) || duration < 0.5 || duration > 10) throw new Error('Duration must be between 0.5 and 10 seconds');
const chosen = value('--theme', 'midas');
if (!themes.includes(chosen)) throw new Error('Unknown theme');
async function run(command, commandArgs, env = {}) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, { cwd: root, env: { ...process.env, ...env }, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`${command} failed: ${signal ?? code}`)));
  });
}
await mkdir(output, { recursive: true });
if (args.includes('--serve')) {
  const port = Number(value('--port', '4186'));
  const server = createServer(async (request, response) => {
    try {
      if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405).end(); return; }
      const url = new URL(request.url, 'http://localhost');
      const target = path.resolve(output, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
      if (!target.startsWith(output + path.sep)) { response.writeHead(403).end(); return; }
      const content = await readFile(target);
      const types = { '.html': 'text/html', '.json': 'application/json', '.png': 'image/png', '.gif': 'image/gif', '.apng': 'image/apng', '.webp': 'image/webp' };
      response.writeHead(200, { 'Content-Type': types[path.extname(target)] ?? 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      response.end(request.method === 'HEAD' ? undefined : content);
    } catch { response.writeHead(404).end('Not found'); }
  });
  server.listen(port, '127.0.0.1', () => console.log(`Showcase review: http://127.0.0.1:${port}`));
} else {
  for (const theme of args.includes('--all') ? themes : [chosen]) {
    const directory = path.join(output, theme);
    if (!args.includes('--encode-only')) {
      await run(process.execPath, ['scripts/capture-showcase-local.mjs'], {
        FREED_SHOWCASE_URL: value('--url', 'http://localhost:1446'),
        FREED_SHOWCASE_OUTPUT: directory,
        FREED_SHOWCASE_THEME: theme,
        FREED_SHOWCASE_DESKTOP_ONLY: args.includes('--desktop-only') ? '1' : '0',
        FREED_SHOWCASE_SQLITE_MEMORY: '1',
      });
    }
    const manifest = JSON.parse(await readFile(path.join(directory, 'freed-showcase-manifest.json'), 'utf8'));
    if (manifest.captures.some(c => c.theme !== theme) || manifest.captures.length !== 6) throw new Error('Capture theme or screen count mismatch');
    if (manifest.transparentCanvas !== true) throw new Error('Recapture required: saved frames predate transparent canvas support');
    if ((manifest.sourcePixelWidth ?? 1440) < 1920) throw new Error("Recapture required: 1920px exports need high-density source frames");
    const revision = new Date().toISOString().replace(/[:.]/g, '-');
    const revisionDirectory = path.join(directory, 'revisions', revision);
    await mkdir(revisionDirectory, { recursive: true });
    // Snapshot the actual source frames so later recapture cannot change a reviewed revision.
    for (const capture of manifest.captures) {
      if (!/^[a-z0-9-]+\.png$/.test(capture.file)) throw new Error('Unsafe capture filename');
      await copyFile(path.join(directory, capture.file), path.join(revisionDirectory, capture.file));
    }
    const order = manifest.gifOrder;
    if (order.length !== manifest.captures.length || new Set(order).size !== order.length || order.some(f => !manifest.captures.some(c => c.file === f))) throw new Error('Invalid frame order');
    await writeFile(path.join(revisionDirectory, 'gif-order.txt'), order.map(f => `file '${f}'\nduration ${duration}`).join('\n') + `\nfile '${order.at(-1)}'\n`);
    const filename = `freed-showcase-${theme}-quality90.webp`;
    const animation = path.join(revisionDirectory, filename);
    const inputArgs = ['-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', path.join(revisionDirectory, 'gif-order.txt')];
    const webpArgs = ['-vf', 'scale=1920:-1:flags=lanczos,format=bgra', '-fps_mode', 'passthrough', '-frames:v', String(order.length), '-c:v', 'libwebp_anim'];
    await run(process.env.FFMPEG_PATH ?? 'ffmpeg', [...inputArgs, ...webpArgs, '-lossless', '0', '-quality', '90', '-compression_level', '6', '-loop', '0', animation]);
    const bytes = (await stat(animation)).size;
    const result = { ...manifest, theme, revision, duration, bytes, format: "webp", quality: 90, width: 1920, height: 1280, animation: `${theme}/revisions/${revision}/${filename}` };
    result.variants = [{ label: 'WebP · quality 90', url: result.animation, bytes }];
    if (args.includes('--compare')) {
      const losslessName = `freed-showcase-${theme}-lossless.webp`;
      const losslessPath = path.join(revisionDirectory, losslessName);
      await run(process.env.FFMPEG_PATH ?? 'ffmpeg', [...inputArgs, ...webpArgs, '-lossless', '1', '-quality', '100', '-compression_level', '6', '-loop', '0', losslessPath]);
      result.variants.push({ label: 'WebP · lossless', url: `${theme}/revisions/${revision}/${losslessName}`, bytes: (await stat(losslessPath)).size });
      const apngName = `freed-showcase-${theme}.apng`;
      const apngPath = path.join(revisionDirectory, apngName);
      await run(process.env.FFMPEG_PATH ?? 'ffmpeg', [...inputArgs, '-vf', 'scale=1920:-1:flags=lanczos,format=rgba', '-fps_mode', 'passthrough', '-frames:v', String(order.length), '-plays', '0', '-final_delay', `${Math.round(duration * 100)}/100`, '-f', 'apng', apngPath]);
      result.variants.push({ label: 'APNG · lossless', url: `${theme}/revisions/${revision}/${apngName}`, bytes: (await stat(apngPath)).size });
    }
    await writeFile(path.join(revisionDirectory, 'manifest.json'), JSON.stringify(result, null, 2));
    await copyFile(animation, path.join(directory, `.freed-showcase-${theme}.webp.pending`));
    await rename(path.join(directory, `.freed-showcase-${theme}.webp.pending`), path.join(directory, `freed-showcase-${theme}.webp`));
    await writeFile(path.join(directory, 'latest.json'), JSON.stringify(result, null, 2));
    console.log(`Built ${theme}: ${(bytes / 1024 / 1024).toFixed(1)} MB, ${duration.toLocaleString()} seconds per screen`);
  }
  const available = [];
  for (const theme of themes) {
    try { available.push(JSON.parse(await readFile(path.join(output, theme, 'latest.json'), 'utf8'))); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  await writeFile(path.join(output, 'index.json'), JSON.stringify(available, null, 2));
  await copyFile(path.join(root, 'scripts/showcase-local-preview.html'), path.join(output, 'index.html'));
  console.log(`Artifacts: ${output}\nServe: node scripts/build-showcase-local.mjs --serve`);
}
