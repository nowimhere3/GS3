import { MediaProvider, MediaOps } from './media-provider.js';

const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'heic', 'heif']);
const VIDEO_EXTS = new Set(['mp4', 'webm', 'mkv', 'mov', 'avi', 'm4v']);
const RAW_EXTS = new Set(['raw', 'dng', 'cr2', 'crw', 'nef', 'nrw', 'orf', 'pef', 'rw2', 'rwl']);

function extOf(name = '') {
  const i = name.lastIndexOf('.');
  if (i < 0) return '';
  return name.slice(i + 1).toLowerCase();
}

function mediaTypeFor(file) {
  const ext = extOf(file.name);
  const mime = file.type || '';

  if (mime.startsWith('video/') || VIDEO_EXTS.has(ext)) return 2; // VIDEO
  if (ext === 'gif') return 4; // GIF
  if (ext === 'svg') return 16; // SVG
  if (RAW_EXTS.has(ext)) return 8; // RAW
  if (mime.startsWith('image/') || IMAGE_EXTS.has(ext)) return 1; // IMAGE
  return 0;
}

function isMediaFile(file) {
  return mediaTypeFor(file) !== 0;
}

function joinLocalPath(base, name) {
  if (!base) return `local://${name}`;
  const normalized = base.endsWith('/') ? base : `${base}/`;
  return `local://${normalized}${name}`;
}

export class LocalFolderProvider extends MediaProvider {
  constructor() {
    super();
    this.collections = new Map(); // collectionId -> { id, name, handle }
    this.itemsByCollection = new Map(); // collectionId -> item[]
    this.favorites = new Set(); // local:// paths
  }

  supports(op) {
    // Conservative default for now: no delete/blacklist in local provider lab phase
    return op === MediaOps.FAVORITE;
  }

  async connectCollection({ id, name, handle }) {
    if (!id) throw new Error('connectCollection requires id');
    if (!handle) throw new Error('connectCollection requires a directory handle');

    this.collections.set(id, { id, name: name || id, handle });
    await this.scanCollection(id);
    return this.collections.get(id);
  }

  async listCollections() {
    return Array.from(this.collections.values()).map(({ id, name }) => ({ id, name }));
  }

  async listItems(collectionId) {
    return (this.itemsByCollection.get(collectionId) || []).map((x) => ({ ...x }));
  }

  async scanCollection(collectionId) {
    const collection = this.collections.get(collectionId);
    if (!collection) throw new Error(`Unknown collection: ${collectionId}`);

    const items = [];
    await this.#walk(collection.handle, '', items);

    this.itemsByCollection.set(collectionId, items);
    return items.map((x) => ({ ...x }));
  }

  async toggleFavorite({ item, collectionId }) {
    if (!item?.path) return;

    if (this.favorites.has(item.path)) this.favorites.delete(item.path);
    else this.favorites.add(item.path);

    const list = this.itemsByCollection.get(collectionId) || [];
    const found = list.find((x) => x.path === item.path);
    if (found) found.isFavorite = this.favorites.has(item.path);
  }

  async #walk(dirHandle, relPath, out) {
    for await (const entry of dirHandle.values()) {
      if (entry.kind === 'directory') {
        const childRel = relPath ? `${relPath}/${entry.name}` : entry.name;
        await this.#walk(entry, childRel, out);
        continue;
      }

      if (entry.kind !== 'file') continue;

      const file = await entry.getFile();
      if (!isMediaFile(file)) continue;

      const parent = relPath;
      const path = joinLocalPath(parent, file.name);

      out.push({
        id: path,
        name: file.name,
        path,
        parentPath: parent ? `local://${parent}/` : 'local://',
        modified: file.lastModified,
        size: file.size,
        type: mediaTypeFor(file),
        isFavorite: this.favorites.has(path),
        file,
      });
    }
  }
}
