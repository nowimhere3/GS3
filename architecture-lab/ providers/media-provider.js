export const MediaOps = Object.freeze({
  REMOVE: 'remove',
  BLACKLIST: 'blacklist',
  FAVORITE: 'favorite',
});

export class MediaProvider {
  // Read API
  async listCollections() {
    throw new Error('listCollections() not implemented');
  }

  async listItems(_collectionId) {
    throw new Error('listItems() not implemented');
  }

  // Capabilities
  supports(_op) {
    return false;
  }

  // Optional mutation APIs
  async removeItem(_ctx) {
    throw new Error('removeItem() not supported');
  }

  async blacklistItem(_ctx) {
    throw new Error('blacklistItem() not supported');
  }

  async toggleFavorite(_ctx) {
    throw new Error('toggleFavorite() not supported');
  }
}
