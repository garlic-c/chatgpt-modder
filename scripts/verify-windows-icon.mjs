import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { NtExecutable, NtExecutableResource, Data, Resource } from 'resedit';
const hash = data => createHash('sha256').update(Buffer.from(data)).digest('hex');
const ico = Data.IconFile.from(await readFile(new URL('../build/icons/Tibo.ico', import.meta.url)));
const expected = ico.icons.map(i => hash(i.data.bin)).sort();
for (const file of process.argv.slice(2)) {
  const exe = NtExecutable.from(await readFile(file), { ignoreCert: true });
  const resources = NtExecutableResource.from(exe);
  const groups = Resource.IconGroupEntry.fromEntries(resources.entries);
  if (!groups.length) throw Error(`No icons: ${file}`);
  for (const group of groups) {
    const actual = group.getIconItemsFromEntries(resources.entries).map(i => hash(i.bin)).sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) throw Error(`Icon mismatch: ${file}`);
  }
  console.log(`${file}: verified ${groups.length} icon group(s), 16/24/32/48/64/128/256 px`);
}
