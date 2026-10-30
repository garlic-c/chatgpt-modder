import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Asar, sha256, type Entry } from "../src/engine/asar";
import { Engine, type EngineServices } from "../src/engine/engine";
import { quotaTarget } from "../src/modules/quota";
export async function makeAsar(path: string, files: Record<string, string>) {
  const header: Entry = { files: {} };
  let offset = 0;
  const data: Buffer[] = [];
  for (const [path, text] of Object.entries(files)) {
    const parts = path.split("/");
    let parent = header;
    for (const part of parts.slice(0, -1))
      parent = parent.files![part] ??= { files: {} };
    const b = Buffer.from(text);
    parent.files![parts.at(-1)!] = {
      size: b.length,
      offset: String(offset),
      integrity: {
        algorithm: "SHA256",
        hash: sha256(b),
        blockSize: 4194304,
        blocks: [sha256(b)],
      },
    };
    offset += b.length;
    data.push(b);
  }
  const json = Buffer.from(JSON.stringify(header)),
    padded = (4 + json.length + 3) & ~3,
    prefix = Buffer.alloc(12 + padded);
  prefix.writeUInt32LE(4, 0);
  prefix.writeUInt32LE(4 + padded, 4);
  prefix.writeUInt32LE(padded, 8);
  prefix.writeUInt32LE(json.length, 12);
  json.copy(prefix, 16);
  await writeFile(path, Buffer.concat([prefix, ...data]));
}
export async function fixture(overrides: Partial<EngineServices> = {}) {
  const temp = await mkdtemp(join(tmpdir(), "cgm-test-")),
    root = join(temp, "ChatGPT.app"),
    asar = join(root, "Contents/Resources/app.asar");
  await mkdir(join(root, "Contents/Resources"), { recursive: true });
  const text = "var eK,Mzn,ab,$;function Ozn(e){return e}";
  await makeAsar(asar, {
    [quotaTarget]: text,
    "untouched.txt": "保留的原始资源",
  });
  await writeFile(join(root, "Contents/Info.plist"), "original plist");
  const archive = await Asar.load(asar);
  const services: EngineServices = {
    clientInfo: async (path) => ({
      root: path,
      version: "test",
      asar: join(path, "Contents/Resources/app.asar"),
      plist: join(path, "Contents/Info.plist"),
      platform: "darwin",
      declaredHeader: null,
    }),
    assertStopped: async () => {},
    updateIntegrity: async (path, hash) => {
      await writeFile(join(path, "Contents/Info.plist"), hash);
    },
    signAndVerify: async () => {},
    adapters: [
      {
        id: "test",
        platform: "darwin",
        version: "test",
        headerHash: archive.headerHash,
        status: "experimental",
        files: { [quotaTarget]: sha256(text) },
      },
    ],
    ...overrides,
  };
  const storage = join(temp, "storage"),
    engine = new Engine(storage, () => {}, services);
  return { temp, root, asar, engine, storage, services };
}
