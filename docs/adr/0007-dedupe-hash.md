# ADR 0007: Stable dedupe hashing

**Status:** accepted

Hashes must not depend on evolving normalization. Identifier-first per source; fallback field hash uses a frozen minimal `descriptionKey` (NFKC, trim, whitespace collapse, strip bidi marks). `hash_version` column + stored raw inputs make a future recompute migration possible. `sources.hash_kind` is sticky and downgrade-only; a downgrade recomputes the source's existing hashes in the same transaction so a later collision-free batch cannot create duplicates.
