/**
 * Credential sealing (ADR 0004). The API only ever holds the X25519 PUBLIC key: it can encrypt a
 * credential object for the sync-worker but can never read one back. The worker owns the private key.
 */
import { createHash } from 'node:crypto';
import sodium from 'libsodium-wrappers';

export async function sealCredentials(
  credentials: Record<string, string>,
  publicKeyB64: string,
): Promise<{ ciphertext: Uint8Array; keyFingerprint: string }> {
  await sodium.ready;
  const publicKey = sodium.from_base64(publicKeyB64, sodium.base64_variants.ORIGINAL);
  if (publicKey.length !== sodium.crypto_box_PUBLICKEYBYTES)
    throw new Error('CREDENTIALS_PUBLIC_KEY has the wrong length');
  const plaintext = sodium.from_string(JSON.stringify(credentials));
  const ciphertext = sodium.crypto_box_seal(plaintext, publicKey);
  sodium.memzero(plaintext);
  return { ciphertext, keyFingerprint: fingerprint(publicKey) };
}

export function fingerprint(publicKey: Uint8Array): string {
  return createHash('sha256').update(publicKey).digest('hex').slice(0, 16);
}
