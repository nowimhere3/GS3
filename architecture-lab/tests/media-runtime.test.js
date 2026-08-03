import { MediaRuntime } from '../runtime/media-runtime.js';
import { FakeProvider } from '../providers/fake-provider.js';
import { LocalFolderProvider } from '../providers/local-folder-provider.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function testOpenCollection() {
  const provider = new FakeProvider();
  const rt = new MediaRuntime({ provider });

  const first = await rt.openCollection('default');
  assert(first.id === 'a', 'openCollection should select first item');
}

async function testNextPreviousWrap() {
  const provider = new FakeProvider();
  const rt = new MediaRuntime({ provider });

  await rt.openCollection('default');
  rt.next(); // b
  rt.next(); // c
  const wrapped = rt.next(); // a
  assert(wrapped.id === 'a', 'next should wrap to first');

  const prev = rt.previous(); // c
  assert(prev.id === 'c', 'previous should wrap to last');
}

async function testRemoveCurrent() {
  const provider = new FakeProvider();
  const rt = new MediaRuntime({ provider });

  await rt.openCollection('default'); // a
  await rt.removeCurrent(); // remove a
  assert(rt.state.items.length === 2, 'removeCurrent should remove one item');
  assert(rt.state.current.id !== 'a', 'current should advance after remove');
}

async function testToggleFavorite() {
  const provider = new FakeProvider();
  const rt = new MediaRuntime({ provider });

  await rt.openCollection('default'); // a
  await rt.toggleFavoriteCurrent();

  const fresh = await provider.listItems('default');
  const a = fresh.find((x) => x.id === 'a');
  assert(a.isFavorite === true, 'toggleFavoriteCurrent should flip favorite');
}

async function testLocalFolderProviderPathModel() {
  const files = [
    { kind: 'file', name: 'pic1.jpg', type: 'image/jpeg', size: 10, lastModified: 1 },
    { kind: 'file', name: 'clip.mp4', type: 'video/mp4', size: 20, lastModified: 2 },
    { kind: 'file', name: 'ignore.txt', type: 'text/plain', size: 1, lastModified: 3 },
  ];

  const handle = {
    async *values() {
      for (const f of files) {
        if (f.kind === 'file') {
          yield {
            kind: 'file',
            name: f.name,
            async getFile() {
              return {
                name: f.name,
                type: f.type,
                size: f.size,
                lastModified: f.lastModified,
              };
            },
          };
        }
      }
    },
  };

  const provider = new LocalFolderProvider();
  await provider.connectCollection({ id: 'local-default', name: 'Local', handle });

  const items = await provider.listItems('local-default');
  assert(items.length === 2, 'LocalFolderProvider should include only media files');
  assert(items.every((x) => x.path.startsWith('local://')), 'Local paths must use local:// scheme');
}

async function run() {
  const tests = [
    testOpenCollection,
    testNextPreviousWrap,
    testRemoveCurrent,
    testToggleFavorite,
    testLocalFolderProviderPathModel,
  ];

  for (const t of tests) {
    await t();
    console.log(`✓ ${t.name}`);
  }

  console.log('\nAll tests passed');
}

run().catch((err) => {
  console.error(`✗ Test failure: ${err.message}`);
  process.exit?.(1);
});
