# Bisik — QA & review notes

A multi-angle pass over the model, frontend, deploy tooling, and tests. Items
marked ✅ were fixed in this pass; ⚠️ are accepted/known scope with rationale.

## Daml model — correctness & security

- ✅ **Quote was not bound to its RFQ.** `Award` matched quotes only by
  `(buyer, instrument, quantity, payInstrument)`, so two of the buyer's own RFQs
  for the same instrument/size could cross-settle. Added `rfqId` (Optional, for
  upgrade-compatibility) stamped with the RFQ's `self` at `SubmitQuote`, and
  `Award` now requires `q.rfqId == Some self`. Test: `testCrossRfqRejected`.
- ✅ **Duplicate quote ids in `Award`** would exercise a choice on the same
  contract twice (the second aborts the whole tx, but silently). Now rejected
  explicitly with a `dedup` length check. Test: `testDuplicateQuoteRejected`.
- ✅ **Vickrey correctness only covered the 2-quote case.** Added
  `testThreeQuoteVickrey` (winner paid the 2nd-lowest, not 3rd/own) and
  `testSingleQuote` (degenerate: pays own price).
- ✅ **Failure modes untested.** Added `testInsufficientCash` (Award aborts
  cleanly, atomic — no partial transfer) and `testWithdraw` (escrow returns).
- ⚠️ **A dealer may submit multiple quotes to one RFQ.** `SubmitQuote` is
  nonconsuming and un-deduped per dealer; each locks a separate asset, so it is
  fund-safe (dealer escrows more, recoverable via `WithdrawQuote`). The UI blocks
  it. Left open on-ledger — a real desk may want multi-quote. Upgrade path: a
  per-(rfq,dealer) key if one-quote-per-dealer is desired.
- ⚠️ **Buyer can bypass Vickrey by exercising `SettleQuote` directly** at any
  `clearingPrice >= dealer ask`. This only lets the buyer *overpay* (never
  underpay the dealer — guarded by `clearingPrice >= price`), so it harms no
  counterparty. `Award` is the intended fair path.
- ⚠️ **Ignored quotes keep a dealer's asset escrowed.** If the buyer never
  awards/cancels, a quoting dealer's bond stays locked. Mitigated: `WithdrawQuote`
  lets the dealer reclaim it unilaterally.
- ✔ **Atomicity holds.** DvP moves both legs inside one transaction; any assert
  failure (wrong instrument, insufficient cash) rolls back the whole exercise.
- ✔ **Privacy holds by construction.** `Quote` has signatories `dealer, buyer`
  and no other observers → rival dealers and the regulator never receive it.
  Asserted directly in `testHappyPathAndPrivacy` and verified on Devnet.

## Frontend (web/)

- ✅ **HTML injection**: ledger-sourced strings (instrument, pay currency) were
  interpolated into `innerHTML` unescaped. Added `esc()` and applied it
  throughout the render path.
- ✅ **No input validation**: `createRFQ`/`submitQuote` now reject non-positive
  or non-numeric quantity/price before submitting.
- ✅ **DevNet transient errors**: reads (`ledger-end`, `active-contracts`) now
  retry 3× with backoff (`retryRead`); command submits are deliberately NOT
  retried (avoids double-submit).
- ✅ **Precise award targeting**: the buyer now settles exactly the RFQ a quote
  was made against (via `rfqId`), not a same-instrument heuristic.
- ⚠️ **Polling model**: the desk polls ACS every 1.8s (8+ requests/cycle). Fine
  for a 3-party demo; a production desk would use the JSON API update stream
  (WebSocket) instead. Noted as scope.

## Deploy tooling (scripts/)

- ✅ **Stale package id**: `devnet.mjs` PKG is now overridable via `BISIK_PKG`
  and documented (regenerate with `daml damlc inspect-dar`).
- ✅ **Package versioning**: bumped to `0.2.0` so the improved model vets
  alongside the earlier `0.1.0` already on the shared validator (Canton rejects
  two hashes for the same name+version).
- ✔ **Idempotency & flakiness**: party allocation is idempotent; command submits
  retry on 5xx with a stable commandId (ledger-side dedup). Reads in `verify`
  can still transiently fail — rerun (DevNet gateway is flaky).
- ⚠️ **Shared M2M user**: all parties act via the one hackathon user `6`; grants
  are self-service. Fine for the shared Devnet validator; a real deployment uses
  per-party external signing.

## Tests

- Suite grew from 1 to 7 behavioural scripts + the seed scripts, all green.
  Covers: happy path, privacy, 1/2/3-quote Vickrey, insufficient cash, withdraw,
  cross-RFQ rejection, duplicate rejection.

## Opportunities (not done — future work)

- CIP-0056 token standard for the cash/asset legs (wallet interop, real DvP).
- Multi-instrument / multi-round RFQ; partial fills.
- WebSocket update stream instead of polling.
- MPC so even the settling buyer can't see losing bids.
- Per-dealer one-quote enforcement if desired.
