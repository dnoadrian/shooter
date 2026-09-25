// Bundles the game into a single self-contained HTML file (dist/instagib.html)
// that runs straight from disk, no server needed.
import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const result = await build({
  entryPoints: ['src/main.js'],
  bundle: true,
  format: 'esm',
  minify: true,
  write: false,
  legalComments: 'eof',
  target: 'es2020',
});
const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const css = await readFile('style.css', 'utf8');
let html = await readFile('index.html', 'utf8');
html = html.replace('<link rel="stylesheet" href="style.css" />', () => `<style>\n${css}</style>`);
html = html.replace('<script type="module" src="src/main.js"></script>', () => `<script type="module">\n${js}</script>`);
if (html.includes('src/main.js') || html.includes('href="style.css"')) throw new Error('failed to inline assets');
await mkdir('dist', { recursive: true });
await writeFile('dist/instagib.html', html);
console.log(`dist/instagib.html  ${(html.length / 1024).toFixed(0)} KB`);

// Fragment variant for hosts that supply their own <html>/<head>/<body>
// skeleton: head content (minus charset/viewport) followed by the body.
const head = html.match(/<head>([\s\S]*)<\/head>/)[1].replace(/<meta (charset|name="viewport")[^>]*>\s*/g, '');
const body = html.match(/<body>([\s\S]*)<\/body>/)[1];
const fragment = `${head.trim()}\n${body.trim()}\n`;
await writeFile('dist/instagib-fragment.html', fragment);
console.log(`dist/instagib-fragment.html  ${(fragment.length / 1024).toFixed(0)} KB`);
