import assert from 'node:assert/strict';
import { test } from 'vitest';
import { createE2eCredentialStore } from './credentials.mjs';

test('credential is held in runner memory and removed on disconnect and shutdown', async () => {
  const store = createE2eCredentialStore();
  await store.start();
  try {
    assert.equal(store.exists(), false);
    const url = 'http://127.0.0.1:4456/credential';
    assert.equal((await fetch(url)).status, 204);
    assert.equal((await fetch(url, { method: 'PUT', body: 'ntn_e2e_fake_test' })).status, 204);
    assert.equal(store.exists(), true);
    assert.equal(await (await fetch(url)).text(), 'ntn_e2e_fake_test');
    assert.equal((await fetch(url, { method: 'DELETE' })).status, 204);
    assert.equal(store.exists(), false);
  } finally { await store.stop(); }
  assert.equal(store.exists(), false);
});
