# ADR 0004: Credentials via libsodium sealed boxes

**Status:** accepted

Alternatives: symmetric key shared by api and worker (api could decrypt), passphrase prompt (blocks unattended sync). Chosen: X25519 sealed boxes. The API holds the public key and can only encrypt; the worker holds the private key file, mounted read-only, and decrypts in memory during a scrape. Rotation re-wraps all rows inside the worker.
