import { createReadStream } from "./native-fs";
import {
  lstat,
  readdir,
  readlink,
  readFile,
  writeFile,
  rename,
  open,
} from "./native-fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
export async function exists(path: string) {
  try {
    await lstat(path);
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw e;
  }
}
export async function fileHash(path: string) {
  const h = createHash("sha256");
  for await (const part of createReadStream(path)) h.update(part);
  return h.digest("hex");
}
export async function treeHash(root: string) {
  const h = createHash("sha256");
  async function visit(path: string, relative: string) {
    const s = await lstat(path);
    h.update(JSON.stringify([relative, s.mode & 0o777]));
    if (s.isSymbolicLink()) h.update("L" + (await readlink(path)));
    else if (s.isDirectory()) {
      h.update("D");
      for (const name of (await readdir(path)).sort())
        await visit(join(path, name), relative + "/" + name);
    } else if (s.isFile()) {
      h.update("F" + s.size + ":" + (await fileHash(path)));
    } else throw Error("应用包含不支持的特殊文件");
  }
  await visit(root, "");
  return h.digest("hex");
}
export async function atomicJson(path: string, value: unknown) {
  const tmp = path + ".tmp";
  const f = await open(tmp, "w", 0o600);
  try {
    await f.writeFile(JSON.stringify(value, null, 2));
    await f.sync();
  } finally {
    await f.close();
  }
  await rename(tmp, path);
}
export async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8"));
}
