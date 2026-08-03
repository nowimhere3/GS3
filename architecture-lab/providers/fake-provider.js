import { MediaProvider, MediaOps } from './media-provider.js';

export class FakeProvider extends MediaProvider {
  constructor(seed = {}) {
    super();
    this.collections = seed.collections ?? [{ id: 'default', name: 'Default' }];
    this.itemsByCollection =
      seed.itemsByCollection ??
      {
        default: [
          { id: 'a', url: 'https://a.test', isFavorite: false },
          { id: 'b', url: 'https://b.test', isFavorite: false },
          { id: 'c', url: 'https://c.test', isFavorite: false },
        ],
      };

    this.blacklist = new Set();
  }

  async listCollections() {
    return this.collections.slice();
  }

  async listItems(collectionId) {
    return (this.itemsByCollection[collectionId] ?? []).map((x) => ({ ...x }));
  }

  supports(op) {
    return (
      op === MediaOps.REMOVE ||
      op === MediaOps.FAVORITE ||
      op === MediaOps.BLACKLIST
    );
  }

  async removeItem({ item, collectionId }) {
    const list = this.itemsByCollection[collectionId] ?? [];
    this.itemsByCollection[collectionId] = list.filter((x) => x.id !== item.id);
  }

  async toggleFavorite({ item, collectionId }) {
    const list = this.itemsByCollection[collectionId] ?? [];
    const found = list.find((x) => x.id === item.id);
    if (found) found.isFavorite = !found.isFavorite;
  }

  async blacklistItem({ item, collectionId }) {
    this.blacklist.add(item.url ?? item.id);
    await this.removeItem({ item, collectionId });
  }
}
