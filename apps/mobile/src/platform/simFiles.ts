import { Directory, File, Paths } from 'expo-file-system';

import type { SimFiles } from '../services/labs';

/**
 * Downloaded sims in the app's documents folder (`sims/{id}/{version}/`), so a lab that ran once
 * runs offline (LAB-03) and survives low-storage cache sweeps. Files are written only under this
 * folder; the cache never follows a reference outside a sim's folder (services/labs.ts).
 */
export function deviceSimFiles(): SimFiles {
  const root = new Directory(Paths.document, 'sims');
  const parentOf = (uri: string) => new File(uri).parentDirectory;
  return {
    folderUri(id, version) {
      const uri = new Directory(root, id, version).uri;
      return uri.endsWith('/') ? uri : `${uri}/`;
    },
    exists(uri) {
      try {
        return new File(uri).exists;
      } catch {
        return false;
      }
    },
    readText(uri) {
      return new File(uri).text();
    },
    writeText(uri, text) {
      parentOf(uri).create({ intermediates: true, idempotent: true });
      const f = new File(uri);
      if (!f.exists) f.create({ intermediates: true });
      f.write(text);
    },
    async download(url, uri) {
      parentOf(uri).create({ intermediates: true, idempotent: true });
      const f = await File.downloadFileAsync(url, new File(uri), { idempotent: true });
      return f.size ?? 0;
    },
    removeFolder(uri) {
      const d = new Directory(uri);
      if (d.exists) d.delete();
    },
  };
}
