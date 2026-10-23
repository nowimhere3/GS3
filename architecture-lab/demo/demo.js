import { MediaRuntime } from '../runtime/media-runtime.js';
import { FakeProvider } from '../providers/fake-provider.js';
import { UrlProvider } from '../providers/url-provider.js';
import { LocalFolderProvider } from '../providers/local-folder-provider.js';

const out = document.getElementById('out');
const providerLabel = document.getElementById('providerLabel');
const providerSelect = document.getElementById('providerSelect');
const pickFolderBtn = document.getElementById('pickFolder');

const fakeProvider = new FakeProvider();

let _db = {
  default: ['https://example.com/a', 'https://example.com/b', 'https://example.com/c']
};
let _favs = new Set();

const urlProvider = new UrlProvider({
  getDb: () => _db,
  setDb: (db) => { _db = db; },
  pushDatabaseToRemote: async () => {},
  addToBlacklist: () => {},
  getFavorites: () => _favs,
  setFavorites: (s) => { _favs = s; }
});

const localProvider = new LocalFolderProvider();

let runtime = null;
let activeProvider = fakeProvider;
let activeCollection = 'default';

function render(event = 'init') {
  out.textContent = JSON.stringify(
    {
      event,
      provider: providerLabel.textContent,
      collectionId: runtime?.state.collectionId ?? null,
      index: runtime?.state.index ?? -1,
      current: runtime?.state.current ?? null,
      totalItems: runtime?.state.items.length ?? 0,
      order: runtime?.state.order ?? []
    },
    null,
    2
  );
}

function mountRuntime(provider, providerName) {
  activeProvider = provider;
  providerLabel.textContent = providerName;
  runtime = new MediaRuntime({ provider });
  runtime.onChange(({ event }) => render(event));
  render('provider-mounted');
}

providerSelect.onchange = () => {
  const value = providerSelect.value;
  if (value === 'fake') {
    mountRuntime(fakeProvider, 'FakeProvider');
    activeCollection = 'default';
    pickFolderBtn.disabled = true;
  } else if (value === 'url') {
    mountRuntime(urlProvider, 'UrlProvider');
    activeCollection = 'default';
    pickFolderBtn.disabled = true;
  } else {
    mountRuntime(localProvider, 'LocalFolderProvider');
    activeCollection = 'local-default';
    pickFolderBtn.disabled = false;
  }
};

document.getElementById('open').onclick = async () => {
  await runtime.openCollection(activeCollection);
};

document.getElementById('next').onclick = () => runtime.next();
document.getElementById('prev').onclick = () => runtime.previous();
document.getElementById('shuffle').onclick = () => runtime.shuffle();
document.getElementById('remove').onclick = async () => { await runtime.removeCurrent(); };
document.getElementById('favorite').onclick = async () => { await runtime.toggleFavoriteCurrent(); };

document.getElementById('rescan').onclick = async () => {
  if (activeProvider !== localProvider) return;
  await localProvider.scanCollection(activeCollection);
  if (runtime.state.collectionId === activeCollection) {
    await runtime.openCollection(activeCollection);
  }
};

pickFolderBtn.onclick = async () => {
  if (!window.showDirectoryPicker) {
    alert('File System Access API not available in this browser/environment.');
    return;
  }

  try {
    const handle = await window.showDirectoryPicker({ mode: 'read' });
    await localProvider.connectCollection({
      id: 'local-default',
      name: handle.name,
      handle,
    });
    activeCollection = 'local-default';
    await runtime.openCollection(activeCollection);
  } catch (e) {
    console.error(e);
  }
};

mountRuntime(fakeProvider, 'FakeProvider');
pickFolderBtn.disabled = true;
render();
