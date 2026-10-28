import type { TFile, Vault } from 'obsidian';
import { isIncluded, MAX_FILE_BYTES, parentPath, validatePath } from '../shared/paths';
import {
  ChangedDuringSync,
  snapshot,
  type FileEntry,
  type Snapshot,
  type SyncStore,
} from '../sync/engine';

export class VaultStore implements SyncStore {
  constructor(
    private readonly vault: Vault,
    private readonly recoveryFolder: string,
  ) {}

  async list(): Promise<FileEntry[]> {
    return this.vault
      .getFiles()
      .filter((file) => isIncluded(file.path, this.vault.configDir))
      .map((file) => ({ path: file.path, size: file.stat.size }));
  }

  async read(path: string): Promise<Snapshot | undefined> {
    const file = this.findFile(path);
    if (!file) return undefined;
    if (file.stat.size > MAX_FILE_BYTES) throw new Error('Файл превышает лимит 50 МиБ.');

    return snapshot(await this.vault.readBinary(file));
  }

  async write(path: string, data: ArrayBuffer, expected: Snapshot | undefined): Promise<void> {
    validatePath(path);
    if (!isIncluded(path, this.vault.configDir))
      throw new Error('Служебный файл исключён из синхронизации.');
    if (data.byteLength > MAX_FILE_BYTES) throw new Error('Файл превышает лимит 50 МиБ.');

    const current = await this.read(path);
    if (current?.hash !== expected?.hash) throw new ChangedDuringSync(path);
    await this.ensureFolders(parentPath(path));

    if (!expected) {
      if (this.vault.getAbstractFileByPath(path)) throw new ChangedDuringSync(path);
      await this.vault.createBinary(path, data);
      return;
    }

    await this.backup(expected);
    const file = this.findFile(path);
    if (!file) throw new ChangedDuringSync(path);

    if (path.toLowerCase().endsWith('.md')) {
      const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(data);
      await this.vault.process(file, (currentText) => {
        if (!equalBytes(new TextEncoder().encode(currentText), new Uint8Array(expected.data))) {
          throw new ChangedDuringSync(path);
        }
        return text;
      });
    } else {
      // Obsidian has no atomic binary process API; recheck immediately before writing and keep a recovery copy.
      if ((await this.read(path))?.hash !== expected.hash) throw new ChangedDuringSync(path);
      await this.vault.modifyBinary(file, data);
    }
  }

  private findFile(path: string): TFile | undefined {
    validatePath(path);
    if (!isIncluded(path, this.vault.configDir))
      throw new Error('Служебный файл исключён из синхронизации.');

    const file = this.vault.getFileByPath(path);
    if (!file && this.vault.getAbstractFileByPath(path)) {
      throw new Error(`Вместо файла существует папка: ${path}`);
    }
    return file ?? undefined;
  }

  private async ensureFolders(path: string): Promise<void> {
    if (!path) return;
    let current = '';

    for (const part of path.split('/')) {
      current = current ? `${current}/${part}` : part;
      const existing = this.vault.getAbstractFileByPath(current);
      if (existing && !('children' in existing))
        throw new Error(`Вместо папки существует файл: ${current}`);
      if (!existing) await this.vault.createFolder(current);
    }
  }

  private async backup(file: Snapshot): Promise<void> {
    let current = '';
    for (const part of this.recoveryFolder.split('/')) {
      current = current ? `${current}/${part}` : part;
      if (!(await this.vault.adapter.exists(current))) await this.vault.adapter.mkdir(current);
    }

    const path = `${this.recoveryFolder}/${file.hash}`;
    if (!(await this.vault.adapter.exists(path)))
      await this.vault.adapter.writeBinary(path, file.data);
  }
}

function equalBytes(first: Uint8Array, second: Uint8Array): boolean {
  return first.length === second.length && first.every((byte, index) => byte === second[index]);
}
