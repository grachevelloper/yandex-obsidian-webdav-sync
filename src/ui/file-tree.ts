import type { PlanEntry } from '../sync/types';

export interface FileFolder {
  name: string;
  path: string;
  folders: Map<string, FileFolder>;
  files: PlanEntry[];
  count: number;
}

export function fileTree(entries: PlanEntry[]): FileFolder {
  const root: FileFolder = {
    name: '',
    path: '',
    folders: new Map(),
    files: [],
    count: entries.length,
  };

  for (const entry of entries) {
    const parts = entry.path.split('/');
    let parent = root;
    for (const name of parts.slice(0, -1)) {
      let folder = parent.folders.get(name);
      if (!folder) {
        folder = {
          name,
          path: parent.path ? `${parent.path}/${name}` : name,
          folders: new Map(),
          files: [],
          count: 0,
        };
        parent.folders.set(name, folder);
      }
      folder.count++;
      parent = folder;
    }
    parent.files.push(entry);
  }

  return root;
}
