import type { FileStore } from '@smriti/app-core';
import { Directory, File, Paths } from 'expo-file-system';

/**
 * app-core's `FileStore` for downloaded content bundles, in the app's documents folder
 * (`content/bundles/…`), so pinned downloads survive the OS's cache sweeps (LRN-15). Paths come
 * from `ContentManager.pathFor` and never leave this folder.
 */
export function deviceBundleFiles(): FileStore {
  const root = new Directory(Paths.document, 'content');
  const fileAt = (path: string) => {
    if (path.split('/').some((part) => part === '..' || part === '')) throw new Error('bad content path');
    return new File(root, ...path.split('/'));
  };
  return {
    async read(path) {
      const f = fileAt(path);
      return f.exists ? f.bytes() : null;
    },
    async write(path, data) {
      const f = fileAt(path);
      f.parentDirectory.create({ intermediates: true, idempotent: true });
      if (!f.exists) f.create({ intermediates: true });
      f.write(data);
    },
    async delete(path) {
      const f = fileAt(path);
      if (f.exists) f.delete();
    },
    async exists(path) {
      return fileAt(path).exists;
    },
  };
}
