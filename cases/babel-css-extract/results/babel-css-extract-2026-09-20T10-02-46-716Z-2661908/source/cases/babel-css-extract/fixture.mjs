import { prepareFixture as prepareJsFixture } from '../babel-loader/case.mjs';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
export async function prepareFixture(options) {
  const fixture = await prepareJsFixture(options);
  let cssBytes = 0;
  for (let i = 0; i < options.modules; i++) {
    const stem = `module-${String(i).padStart(5, '0')}`;
    const css = `.bench_${i} { display: flex; padding: ${i % 16}px; color: rgb(${i % 256}, 40, 80); }\n` +
      `.bench_${i}:hover { opacity: 0.85; }\n.bench_${i} > span { font-weight: 600; }\n`;
    const filename = path.join(fixture.fixture, stem + '.js');
    const extra = `import { bench_${i} as cssClass } from './${stem}.module.css';\nif (cssClass !== 'scoped_bench_${i}') throw new Error('Invalid CSS module ${i}');\n`;
    const source = extra + await readFile(filename, 'utf8');
    await writeFile(filename, source);
    await writeFile(path.join(fixture.fixture, stem + '.module.css'), css);
    fixture.fileHashes[stem + '.js'] = createHash('sha256').update(source).digest('hex');
    fixture.fileHashes[stem + '.module.css'] = createHash('sha256').update(css).digest('hex');
    fixture.totalBytes += Buffer.byteLength(extra) + Buffer.byteLength(css);
    cssBytes += Buffer.byteLength(css);
  }
  return { ...fixture, minLines: fixture.minLines + 2, maxLines: fixture.maxLines + 2, cssBytes, cssModules: options.modules,
    origin: 'Binary-tree large JS graph; every JS imports and validates a dedicated CSS Module' };
}
