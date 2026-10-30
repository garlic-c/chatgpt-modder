import * as nodeFs from "node:fs";

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
  cp,
  chmod,
} = physical.promises;
export const createReadStream = physical.createReadStream;
