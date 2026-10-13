# ADR 0002: Money as integer agorot

**Status:** accepted

Amounts are stored as `bigint` agorot and handled as JS safe integers. No floats anywhere in arithmetic. Foreign amounts are stored in their currency's minor unit with the currency code; totals always use the charged ILS amount. Formatting happens only in `@pinkas/shared` `formatAgorot`.
