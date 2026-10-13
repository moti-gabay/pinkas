# ADR 0006: LLM boundary

**Status:** accepted

Every number comes from SQL/domain code; Claude only categorizes and narrates. Payloads are built in one module from an allow-list of fields, tested with a forbidden-fields property test. PDFs default to redacted extracted text; raw PDF requires explicit per-import opt-in. Models: Haiku 5.5 for categorization, Sonnet 5.5 for insights and PDF extraction. Synchronous Messages API only (no Batches API at single-user volume).
