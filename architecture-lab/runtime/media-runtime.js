import { MediaOps } from '../providers/media-provider.js';

export class MediaRuntime {
  constructor({ provider, rng = Math.random } = {}) {
    if (!provider) throw new Error('MediaRuntime requires a provider');
    this.provider = provider;
    this.rng = rng;

    this.state = {
      collectionId: null,
      items: [],
      order: [],
      index: -1,
      current: null,
    };

    this.listeners = new Set();
  }

  onChange(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  _emit(event, extra = {}) {
    const snapshot = {
      collectionId: this.state.collectionId,
      items: this.state.items.slice(),
      order: this.state.order.slice(),
      index: this.state.index,
      current: this.state.current,
    };

    for (const listener of this.listeners) {
      listener({ event, state: snapshot, ...extra });
    }
  }

  _setCurrentFromIndex() {
    if (this.state.index < 0 || this.state.index >= this.state.order.length) {
      this.state.current = null;
      return;
    }
    const itemIndex = this.state.order[this.state.index];
    this.state.current = this.state.items[itemIndex] ?? null;
  }

  async openCollection(collectionId) {
    const items = await this.provider.listItems(collectionId);

    this.state.collectionId = collectionId;
    this.state.items = items.slice();
    this.state.order = items.map((_, i) => i);
    this.state.index = items.length > 0 ? 0 : -1;
    this._setCurrentFromIndex();

    this._emit('collection-opened');
    return this.state.current;
  }

  next() {
    if (!this.state.order.length) return null;
    this.state.index = (this.state.index + 1) % this.state.order.length;
    this._setCurrentFromIndex();
    this._emit('item-changed', { direction: 'next' });
    return this.state.current;
  }

  previous() {
    if (!this.state.order.length) return null;
    const len = this.state.order.length;
    this.state.index = (this.state.index - 1 + len) % len;
    this._setCurrentFromIndex();
    this._emit('item-changed', { direction: 'previous' });
    return this.state.current;
  }

  shuffle() {
    const order = this.state.order.slice();
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }

    this.state.order = order;
    this.state.index = order.length ? 0 : -1;
    this._setCurrentFromIndex();

    this._emit('shuffled');
    return this.state.current;
  }

  async removeCurrent() {
    if (!this.state.current) return null;

    if (!this.provider.supports(MediaOps.REMOVE)) {
      this._emit('op-unsupported', { op: MediaOps.REMOVE });
      return this.state.current;
    }

    const current = this.state.current;
    await this.provider.removeItem({
      item: current,
      collectionId: this.state.collectionId,
    });

    // Remove the current item from items by identity fallback (id preferred)
    const currentIdx = this.state.items.findIndex((x) =>
      current.id != null ? x.id === current.id : x === current
    );
    if (currentIdx >= 0) this.state.items.splice(currentIdx, 1);

    this.state.order = this.state.items.map((_, i) => i);

    if (!this.state.items.length) {
      this.state.index = -1;
      this.state.current = null;
      this._emit('item-removed');
      return null;
    }

    if (this.state.index >= this.state.order.length) {
      this.state.index = 0;
    }

    this._setCurrentFromIndex();
    this._emit('item-removed');
    return this.state.current;
  }

  async toggleFavoriteCurrent() {
    if (!this.state.current) return;

    if (!this.provider.supports(MediaOps.FAVORITE)) {
      this._emit('op-unsupported', { op: MediaOps.FAVORITE });
      return;
    }

    await this.provider.toggleFavorite({
      item: this.state.current,
      collectionId: this.state.collectionId,
    });

    this._emit('favorite-toggled');
  }

  async blacklistCurrent() {
    if (!this.state.current) return;

    if (!this.provider.supports(MediaOps.BLACKLIST)) {
      this._emit('op-unsupported', { op: MediaOps.BLACKLIST });
      return;
    }

    await this.provider.blacklistItem({
      item: this.state.current,
      collectionId: this.state.collectionId,
    });

    this._emit('item-blacklisted');
  }
}
