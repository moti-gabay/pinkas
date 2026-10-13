/**
 * Decrypts a sealed credential box. Only the sync-worker has the private key, which is read from a
 * file mounted read-only. The returned object must be used inside the scrape call and then wiped.
 */
import { readFileSync } from 'node:fs';
import sodium from 'libsodium-wrappers';

export interface Keypair {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}

export async function loadKeypair(privateKeyFile: string): Promise<Keypair> {
  await sodium.ready;
  const privateKey = sodium.from_base64(
    readFileSync(privateKeyFile, 'utf8').trim(),
    sodium.base64_variants.ORIGINAL,
  );
  if (privateKey.length !== sodium.crypto_box_SECRETKEYBYTES)
    throw new Error('worker.key has the wrong length');
  const publicKey = sodium.crypto_scalarmult_base(privateKey);
  return { publicKey, privateKey };
}

export async function openCredentials(
  ciphertext: Uint8Array,
  kp: Keypair,
): Promise<Record<string, string>> {
  await sodium.ready;
  const plaintext = sodium.crypto_box_seal_open(ciphertext, kp.publicKey, kp.privateKey);
  try {
    return JSON.parse(sodium.to_string(plaintext)) as Record<string, string>;
  } finally {
    sodium.memzero(plaintext);
  }
}

/** Overwrites every string value so the secret does not linger in the heap longer than needed. */
export function wipe(credentials: Record<string, string>): void {
  for (const k of Object.keys(credentials)) credentials[k] = '';
}
