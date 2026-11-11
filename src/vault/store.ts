import { t } from '../i18n';
import type { FileManager, TFile, Vault } from 'obsidian';
import {
  isIncluded,
  MAX_FILE_BYTES,
  parentPath,
  recoveredPath,
  validatePath,
} from '../shared/paths';
import { ChangedDuringSync } from '../sync/errors';
import { hashBytes, snapshot } from '../sync/snapshot';
import { MAX_EDITABLE_BYTES } from '../sync/conflict-text';
import type { FileEntry, Snapshot, SyncStore } from '../sync/types';

export class VaultStore implements SyncStore {
  private readonly pendingFolders = new Map<string, Promise<unknown>>();
  private readonly privateFolders = new Map<string, Promise<void>>();

  constructor(
    private readonly vault: Vault,
    private readonly fileManager: FileManager,
    private readonly recoveryFolder: string,
    private readonly include = (path: string) => isIncluded(path, vault.configDir),
    private readonly baselineFolder?: string,
  ) {}

  async list(): Promise<FileEntry[]> {
    return this.vault
      .getFiles()
      .filter((file) => this.include(file.path))
      .map((file) => ({ path: file.path, size: file.stat.size }));
  }

  async read(path: string): Promise<Snapshot | undefined> {
    const file = this.findFile(path);
    if (!file) return undefined;
    if (file.stat.size > MAX_FILE_BYTES) throw new Error(t('File exceeds the 50 MiB limit.'));

    return snapshot(await this.vault.readBinary(file));
  }

  async write(path: string, data: ArrayBuffer, expected: Snapshot | undefined): Promise<void> {
    validatePath(path);
    if (!this.include(path))
      throw new Error(t('Configuration files are excluded from synchronization.'));
    if (data.byteLength > MAX_FILE_BYTES) throw new Error(t('File exceeds the 50 MiB limit.'));

    const current = await this.read(path);
    if (current?.hash !== expected?.hash) throw new ChangedDuringSync(path);
    await this.ensureFolders(parentPath(path));

    if (!expected) {
      if (this.vault.getAbstractFileByPath(path)) throw new ChangedDuringSync(path);
      await this.vault.createBinary(path, data);
      return;
    }

    await this.preserve(expected);
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

  async remove(path: string, expected: Snapshot): Promise<void> {
    const current = await this.read(path);
    if (current?.hash !== expected.hash) throw new ChangedDuringSync(path);
    await this.preserve(expected);
    const file = this.findFile(path);
    if (!file || (await this.read(path))?.hash !== expected.hash) throw new ChangedDuringSync(path);

    // Vault has no conditional delete API; recheck bytes immediately before moving the file to trash.
    await this.fileManager.trashFile(file);
  }

  async move(path: string, targetPath: string, expected: Snapshot): Promise<void> {
    if (this.findFile(targetPath)) throw new ChangedDuringSync(targetPath);
    await this.ensureFolders(parentPath(targetPath));
    const file = this.findFile(path);
    if (!file || (await this.read(path))?.hash !== expected.hash) throw new ChangedDuringSync(path);
    if (this.vault.getAbstractFileByPath(targetPath)) throw new ChangedDuringSync(targetPath);

    await this.fileManager.renameFile(file, targetPath);
  }

  private findFile(path: string): TFile | undefined {
    validatePath(path);
    if (!this.include(path))
      throw new Error(t('Configuration files are excluded from synchronization.'));

    const file = this.vault.getFileByPath(path);
    if (!file && this.vault.getAbstractFileByPath(path)) {
      throw new Error(t('A folder exists instead of a file: {0}', { '0': path }));
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
        throw new Error(t('A file exists instead of a folder: {0}', { '0': current }));
      if (!existing) {
        let creating = this.pendingFolders.get(current);
        if (!creating) {
          creating = this.vault.createFolder(current);
          this.pendingFolders.set(current, creating);
        }
        try {
          await creating;
        } finally {
          if (this.pendingFolders.get(current) === creating) this.pendingFolders.delete(current);
        }
      }
    }
  }

  async preserve(file: Snapshot): Promise<void> {
    await this.ensurePrivateFolder(this.recoveryFolder);
    const path = `${this.recoveryFolder}/${file.hash}`;
    if (!(await this.vault.adapter.exists(path)))
      await this.vault.adapter.writeBinary(path, file.data);
  }

  async restoreCopy(path: string, hash: string): Promise<string> {
    validatePath(path);
    if (!/^[a-f0-9]{64}$/u.test(hash)) throw new Error(t('The previous version is unavailable.'));
    const source = `${this.recoveryFolder}/${hash}`;
    if (!(await this.vault.adapter.exists(source)))
      throw new Error(t('The previous version is unavailable.'));
    const file = await snapshot(await this.vault.adapter.readBinary(source));
    if (file.hash !== hash) throw new Error(t('The previous version is unavailable.'));

    const target = recoveredPath(path, hash);
    const current = await this.read(target);
    if (current?.hash === hash) return target;
    if (current) throw new Error(t('This name is already in use: {0}', { '0': target }));
    await this.write(target, file.data, undefined);
    return target;
  }

  async readBaseline(path: string): Promise<Snapshot | undefined> {
    if (!this.baselineFolder) return undefined;
    const filename = await this.baselineFilename(path);
    const stat = await this.vault.adapter.stat(filename);
    if (stat?.type !== 'file' || stat.size > MAX_EDITABLE_BYTES) return undefined;
    return snapshot(await this.vault.adapter.readBinary(filename));
  }

  async saveBaseline(path: string, file: Snapshot): Promise<void> {
    if (!this.baselineFolder) return;
    await this.ensurePrivateFolder(this.baselineFolder);
    await this.vault.adapter.writeBinary(await this.baselineFilename(path), file.data);
  }

  async forgetBaseline(path: string): Promise<void> {
    if (!this.baselineFolder) return;
    const filename = await this.baselineFilename(path);
    if (await this.vault.adapter.exists(filename)) await this.vault.adapter.remove(filename);
  }

  private async baselineFilename(path: string): Promise<string> {
    const key = await hashBytes(new TextEncoder().encode(path).buffer);
    return `${this.baselineFolder}/${key}`;
  }

  private async ensurePrivateFolder(folder: string): Promise<void> {
    let ready = this.privateFolders.get(folder);
    if (!ready) {
      ready = this.createPrivateFolder(folder);
      this.privateFolders.set(folder, ready);
    }
    try {
      await ready;
    } catch (error) {
      if (this.privateFolders.get(folder) === ready) this.privateFolders.delete(folder);
      throw error;
    }
  }

  private async createPrivateFolder(folder: string): Promise<void> {
    let current = '';
    for (const part of folder.split('/')) {
      current = current ? `${current}/${part}` : part;
      if (!(await this.vault.adapter.exists(current))) await this.vault.adapter.mkdir(current);
    }
  }
}

function equalBytes(first: Uint8Array, second: Uint8Array): boolean {
  return first.length === second.length && first.every((byte, index) => byte === second[index]);
}
