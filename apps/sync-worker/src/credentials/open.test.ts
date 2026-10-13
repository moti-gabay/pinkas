import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sodium from 'libsodium-wrappers';
import { describe, expect, it } from 'vitest';
import { loadKeypair, openCredentials, wipe } from './open.js';

describe('sealed credentials', () => {
  it('round-trips through the public key only, and the private key opens it', async () => {
    await sodium.ready;
    const kp = sodium.crypto_box_keypair();
    const dir = mkdtempSync(join(tmpdir(), 'pinkas-key-'));
    writeFileSync(
      join(dir, 'worker.key'),
      sodium.to_base64(kp.privateKey, sodium.base64_variants.ORIGINAL),
    );
    const sealed = sodium.crypto_box_seal(
      sodium.from_string(JSON.stringify({ username: 'u', password: 'p' })),
      kp.publicKey,
    );
    const loaded = await loadKeypair(join(dir, 'worker.key'));
    const creds = await openCredentials(sealed, loaded);
    expect(creds).toEqual({ username: 'u', password: 'p' });
    wipe(creds);
    expect(creds).toEqual({ username: '', password: '' });
    const other = sodium.crypto_box_keypair();
    await expect(
      openCredentials(sealed, { publicKey: other.publicKey, privateKey: other.privateKey }),
    ).rejects.toThrow();
  });
});
