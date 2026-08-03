import { MediaProvider, MediaOps } from './media-provider.js';

/**
 * Lab-only URL provider around existing DB shape:
 * {
 *   folderA: ["https://...", "https://..."],
 *   folderB: [...]
 * }
 *
 * Pass adapters so this file stays pure and testable.
 */
export class UrlProvider extends MediaProvider {
  constructor({
    getDb,
    setDb,
    pushDatabaseToRemote,
    addToBlacklist,
    getFavorites,
    setFavorites,
  }) {
    super();
    this.getDb = getDb;
    this.setDb = setDb;
    this.pushDatabaseToRemote = pushDatabaseToRemote;
    this.addToBlacklist = addToBlacklist;
    this.getFavorites = getFavorites ?? (() => new Set());
    this.setFavorites = setFavorites ?? (() => {});
  }

  supports(op) {
    return (
      op === MediaOps.REMOVE ||
      op === MediaOps.FAVORITE ||
      op === MediaOps.BLACKLIST
    );
  }

  async listCollections() {
    const db = this.getDb() ?? {};
    return Object.keys(db).map((id) => ({ id, name: id }));
  }

  async listItems(collectionId) {
    const db = this.getDb() ?? {};
    const urls = db[collectionId] ?? [];
    const favs = this.getFavorites();

    return urls.map((url, i) => ({
      id: `${collectionId}:${i}:${url}`,
      url,
      isFavorite: favs.has(url),
    }));
  }

  async removeItem({ item, collectionId }) {
    const db = this.getDb() ?? {};
    const current = db[collectionId] ?? [];
    db[collectionId] = current.filter((url) => url !== item.url);
    this.setDb(db);

    await this.pushDatabaseToRemote?.('Lab removeItem()', true);
  }

  async blacklistItem({ item, collectionId }) {
    this.addToBlacklist?.(item.url);
    await this.removeItem({ item, collectionId });
  }

  async toggleFavorite({ item }) {
    const favs = new Set(this.getFavorites());
    if (favs.has(item.url)) favs.delete(item.url);
    else favs.add(item.url);
    this.setFavorites(favs);
  }
}
