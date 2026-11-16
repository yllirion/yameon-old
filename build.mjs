// npm run build → dist/metalmadness.html (single file, core + client inlined; opens by double-click)
import { build } from 'esbuild';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
const { outputFiles } = await build({ entryPoints: ['client/main.js'], bundle: true, format: 'iife', minify: true, write: false });
const imgs = {};
for (const f of await readdir('client/img')) imgs[f.replace('.png', '')] = 'data:image/png;base64,' + (await readFile('client/img/' + f)).toString('base64');
const html = (await readFile('client/index.html', 'utf8')).replace('<script type="module" src="main.js"></script>', () => `<script>globalThis.__IMG=${JSON.stringify(imgs)}</script><script>${outputFiles[0].text}</script>`);
await mkdir('dist', { recursive: true });
await writeFile('dist/metalmadness.html', html);
console.log('dist/metalmadness.html', (html.length / 1024).toFixed(0) + ' KB');
