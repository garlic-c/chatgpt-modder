const fs = require('node:fs/promises');
const path = require('node:path');

// Cross-platform resource editing: no Wine or signing credential required.
module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;
  const { NtExecutable, NtExecutableResource, Data, Resource } = await import('resedit');
  const target = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`);
  const exe = NtExecutable.from(await fs.readFile(target), { ignoreCert: true });
  const resources = NtExecutableResource.from(exe);
  const ico = Data.IconFile.from(await fs.readFile(path.join(context.packager.projectDir, 'build/icons/Tibo.ico')));
  const groups = Resource.IconGroupEntry.fromEntries(resources.entries);
  if (!groups.length) throw Error('Windows executable has no icon group');
  for (const group of groups) {
    Resource.IconGroupEntry.replaceIconsForResource(resources.entries, group.id, group.lang, ico.icons.map(item => item.data));
  }
  resources.outputResource(exe);
  await fs.writeFile(target, Buffer.from(exe.generate()));
};
