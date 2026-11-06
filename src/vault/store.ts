import { t } from '../i18n';
import type { FileManager, TFile, Vault } from 'obsidian';
import { isIncluded, MAX_FILE_BYTES, parentPath, validatePath } from '../shared/paths';
import { ChangedDuringSync } from '../sync/errors';
import { snapshot } from '../sync/snapshot';
import type { FileEntry, Snapshot, SyncStore } from '../sync/types';

export class VaultStore implements SyncStore {
  private readonly pendingFolders = new Map<string, Promise<unknown>>();
  private recoveryFolderReady?: Promise<void>;

  constructor(
    private readonly vault: Vault,
    private readonly fileManager: FileManager,
    private readonly recoveryFolder: string,
    private readonly include = (path: string) => isIncluded(path, vault.configDir),
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
    const ready = (this.recoveryFolderReady ??= this.ensureRecoveryFolder());
    try {
      await ready;
    } catch (error) {
      if (this.recoveryFolderReady === ready) this.recoveryFolderReady = undefined;
      throw error;
    }

    const path = `${this.recoveryFolder}/${file.hash}`;
    if (!(await this.vault.adapter.exists(path)))
      await this.vault.adapter.writeBinary(path, file.data);
  }

  private async ensureRecoveryFolder(): Promise<void> {
    let current = '';
    for (const part of this.recoveryFolder.split('/')) {
      current = current ? `${current}/${part}` : part;
      if (!(await this.vault.adapter.exists(current))) await this.vault.adapter.mkdir(current);
    }
  }
}

function equalBytes(first: Uint8Array, second: Uint8Array): boolean {
  return first.length === second.length && first.every((byte, index) => byte === second[index]);
}
