// Base44 publica cada función solo con su carpeta + base44/shared/. Este test
// falla si una función (o shared/) importa archivos de la carpeta de OTRA
// función, que en producción no existirían (error "función no publicada").
import { assertEquals } from 'jsr:@std/assert@1';

const root = new URL('../base44/', import.meta.url);
const fnRoot = new URL('functions/', root);
const sharedRoot = new URL('shared/', root);
const importRe = /(?:import|export)[^'"]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;

async function* walk(dir: URL): AsyncGenerator<URL> {
  for await (const e of Deno.readDir(dir)) {
    const u = new URL(e.name + (e.isDirectory ? '/' : ''), dir);
    if (e.isDirectory) yield* walk(u); else if (/\.(ts|js)$/.test(e.name)) yield u;
  }
}

Deno.test('despliegue: ninguna función importa archivos de otra función', async () => {
  const malos: string[] = [];
  for await (const fnDir of Deno.readDir(fnRoot)) {
    if (!fnDir.isDirectory) continue;
    const own = new URL(fnDir.name + '/', fnRoot).href;
    const files = [];
    for await (const f of walk(new URL(fnDir.name + '/', fnRoot))) files.push(f);
    for await (const f of walk(sharedRoot)) files.push(f);
    for (const f of files) {
      const src = await Deno.readTextFile(f);
      for (const m of src.matchAll(importRe)) {
        const spec = m[1] ?? m[2];
        if (!spec || !spec.startsWith('.')) continue;
        const target = new URL(spec, f).href;
        const ok = target.startsWith(own) || target.startsWith(sharedRoot.href);
        if (!ok) malos.push(`${fnDir.name}: ${f.href.replace(root.href, '')} → ${spec}`);
      }
    }
  }
  assertEquals([...new Set(malos)], []);
});
