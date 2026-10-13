# ADR 0003: Installments counted per charged installment

**Status:** accepted

Each installment (תשלום) is a row dated on its billing month, matching the cash that actually leaves the account and the bank statement. This is the library's default (`combineInstallments: false`, which shifts installment N forward N−1 months). The full purchase is visible through `installment_group_key`.
