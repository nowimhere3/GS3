import { MediaRuntime } from '../runtime/media-runtime.js';
import { FakeProvider } from '../providers/fake-provider.js';

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

async function run() {
  const tests = [
    testOpenCollection,
    testNextPreviousWrap,
    testRemoveCurrent,
    testToggleFavorite,
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
