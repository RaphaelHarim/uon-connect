import { createReadStream } from 'node:fs';
import { access, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';

/** Private object storage. Files are never served directly; every download goes through an authorised route. */
export interface Storage {
  readonly driver: string;
  put(key: string, data: Buffer): Promise<void>;
  read(key: string): Promise<Readable>;
  remove(key: string): Promise<void>;
  health(): Promise<{ ok: boolean; detail?: string }>;
}

const SAFE_KEY = /^[a-z0-9][a-z0-9/_-]{8,200}$/;

export class LocalDiskStorage implements Storage {
  readonly driver = 'local';
  constructor(private readonly root: string) {}

  private resolve(key: string) {
    if (!SAFE_KEY.test(key) || key.includes('..')) throw new Error('Chave de armazenamento inválida');
    const full = path.resolve(this.root, key);
    if (!full.startsWith(path.resolve(this.root) + path.sep)) throw new Error('Chave fora do diretório de armazenamento');
    return full;
  }

  async put(key: string, data: Buffer) {
    const full = this.resolve(key);
    await mkdir(path.dirname(full), { recursive: true, mode: 0o750 });
    await writeFile(full, data, { mode: 0o640, flag: 'wx' });
  }

  async read(key: string) {
    const full = this.resolve(key);
    await access(full);
    return createReadStream(full);
  }

  async remove(key: string) {
    await rm(this.resolve(key), { force: true });
  }

  async health() {
    try {
      await mkdir(this.root, { recursive: true, mode: 0o750 });
      const s = await stat(this.root);
      return { ok: s.isDirectory() };
    } catch (err) {
      return { ok: false, detail: (err as Error).message };
    }
  }
}
