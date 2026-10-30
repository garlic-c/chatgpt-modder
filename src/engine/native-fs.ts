import * as nodeFs from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Electron virtualizes *.asar as directories. A modifier must always operate
// on physical files, including directory copies and whole-tree fingerprints.
const physical: typeof nodeFs = process.versions.electron
  ? require("original-fs")
  : nodeFs;
export const {
  open,
  rename,
  unlink,
  readFile,
  writeFile,
  lstat,
  realpath,
  mkdtemp,
  rm,
  readdir,
  readlink,
  mkdir,
  chmod,
} = physical.promises;
export const createReadStream = physical.createReadStream;

// Node recreates symlinks using the current umask, which can change framework
// link permission bits and invalidate a precise backup. Restore source link modes
// on macOS without dereferencing links or changing their targets.
export const cp: typeof physical.promises.cp = async (
  source,
  destination,
  options,
) => {
  await physical.promises.cp(source, destination, options);
  if (process.platform !== "darwin" || !physical.promises.lchmod) return;
  const pathString = (value: string | URL) =>
    typeof value === "string" ? value : fileURLToPath(value);
  const preserve = async (from: string, to: string): Promise<void> => {
    const info = await physical.promises.lstat(from);
    let target;
    try {
      target = await physical.promises.lstat(to);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    if (info.isSymbolicLink() && target.isSymbolicLink())
      await physical.promises.lchmod(to, info.mode & 0o777);
    else if (info.isDirectory() && target.isDirectory())
      for (const name of await physical.promises.readdir(from))
        await preserve(join(from, name), join(to, name));
  };
  await preserve(pathString(source), pathString(destination));
};
