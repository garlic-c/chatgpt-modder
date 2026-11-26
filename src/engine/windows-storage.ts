import { lstatSync } from "node:fs";
import { join, resolve } from "node:path";
import { sha256 } from "./asar";

export function windowsLocalData(home: string, env = process.env) {
  return join(
    env.LOCALAPPDATA || join(home, "AppData", "Local"),
    "ChatGPT Modder",
  );
}

// Keep an existing transaction, lock and its generations together.
export function backupBase(storage: string, root: string, legacy?: string) {
  const key = sha256(resolve(root));
  const current = join(storage, key);
  if (!legacy || resolve(storage) === resolve(legacy)) return current;
  const old = join(legacy, key);
  if (!lstatSync(old, { throwIfNoEntry: false })) return current;
  if (lstatSync(current, { throwIfNoEntry: false }))
    throw Error("检测到两套客户端备份记录，请先核对恢复路径");
  return old;
}
