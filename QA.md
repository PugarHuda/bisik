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

## Pass 2 — adversarial multi-agent review (Daml, web, tooling)

Three independent adversarial reviewers audited the model, the web layer, and
the deploy tooling. Each finding below was re-verified before acting.

### Model (→ shipped as v0.3.0)
- ✅ **CRITICAL — escrow was unilaterally revocable.** `EscrowedHolding.DeliverTo`
  was `controller dealer`, so a dealer alone could pull the collateral back out
  while their Quote stayed live — enabling double-selling and poisoning the
  buyer's `Award`. Now `controller dealer, buyer`; every legitimate release runs
  inside a Quote choice (which carries both authorities), a standalone dealer
  command cannot. Test: `testEscrowNotUnilaterallyReleasable`.
- ✅ **HIGH — no issuer binding (counterfeit assets/cash).** `Holding` is
  self-issued and neither leg checked the issuer, so a dealer could quote a
  self-issued fake bond, or a buyer settle with self-issued fake cash. Added
  `assetIssuer`/`payIssuer` (Optional) to the RFQ; `SubmitQuote` and `SettleQuote`
  enforce them. Tests: `testCounterfeitAssetRejected`, `testCounterfeitCashRejected`.
- ✅ **LOW/MED — tie determinism.** `Award` now sorts by `(price, dealer)` so a
  price tie resolves deterministically, independent of the buyer's list order.
- ✅ **LOW — `EscrowedHolding` missing `ensure amount > 0.0`** — added.
- ⚠️ **Buyer is the auctioneer (inherent).** Because only the buyer sees all
  sealed quotes, the buyer alone runs the auction: they choose which quotes to
  include in `Award` and thus the clearing price, and could settle a single quote
  at first price. The contract guarantees no dealer is paid **below** their ask
  and DvP atomicity — a buyer can only ever overpay. Forcing true second-price /
  full-set inclusion needs a trusted third-party auctioneer or MPC. Documented in
  README "Honest scope"; the earlier "Vickrey pricing rule is contract-enforced"
  wording was an overclaim and has been corrected.
- ⚠️ **`CancelRFQ` leaves outstanding escrows** — recoverable by each dealer via
  `WithdrawQuote`; documented.

### Web (server + app)
- ✅ **HIGH — proxy bound to all interfaces with a privileged token.** The server
  injected the DevNet Bearer on any `/api/v2/*` and listened on `0.0.0.0`, so any
  LAN client could drive the ledger as `participant_admin`. Now binds `127.0.0.1`.
- ✅ **HIGH — buyer winner/clearing computed across ALL RFQs.** `renderBuyer` now
  scopes quotes/winner/clearing/cash to a single RFQ (by `rfqId`); dropped the
  `|| !rfqId` escape hatch that pulled in foreign quotes.
- ✅ **MED — hung request could freeze the poll loop.** `fetch` had no timeout, so
  a wedged gateway left `busy = true` forever. Added an `AbortController` (12s).
- ✅ **MED — exercises hard-coded the first-seen package id.** Now each exercise
  uses the target contract's own `templateId`, so a package upgrade can't cause a
  version-mismatch rejection.
- ✅ **MED — token cache ignored `expires_in` and had no single-flight.** Server
  now honors the IdP TTL and memoizes the in-flight token fetch (no thundering herd).
- ✅ **MED — `toFixed(1)` silently rounded user input.** Replaced with `posDec()`
  that validates and passes the value through unmangled.
- ✅ **MED — no in-flight guard / weak commandId.** Buttons are disabled during a
  submit; `commandId` is a `crypto.randomUUID()`.
- ✅ **MED — bootstrap threw outside try/catch.** The whole `main()` is wrapped;
  a startup ledger failure shows an error instead of hanging on "connecting…".
- ✅ **LOW — static path guard was dead code.** Added a real
  `resolve(...).startsWith(DIR)` check (traversal was already blocked by
  `URL.pathname` normalization, but the guard is now real, not accidental).
- ✅ **LOW — unexpected error shapes / toast timer stacking** — error parsing now
  probes `message`/`errors[]`; toasts `clearTimeout` the previous handle.

### Tooling & docs
- ✅ **HIGH — Windows Ctrl+C orphaned the JVM + web server.** `cleanup()` now
  `taskkill /T /F` the whole process tree on win32 (was only signalling cmd.exe).
- ✅ **MED — `seed` was non-idempotent** (a second run made `verify` contradict the
  README). `seed` now short-circuits if the party set already has a live RFQ.
- ✅ **MED — read calls had no retry** → a transient blip made `verify` print an
  empty (false) "no data" proof. `api()` reads now retry; `acsAs` fails loudly if
  the ledger returns no offset/array.
- ✅ **MED — `JAVA_HOME` auto-detect was a single path.** Now probes Temurin /
  Program Files / common JVM dirs and fails fast with a clear message.
- ✅ **LOW — secret on the command line.** The server reads `scripts/.env.devnet`
  via `LEDGER_ENV_FILE`; the README no longer inlines the secret.
- ✅ **LOW — no `LICENSE` file / version drift.** Added `LICENSE` (Apache-2.0),
  set `package.json` `version`/`license`, added a `devnet:upload` script.
- ✔ Checked clean: `.env.devnet` untracked, `.example` empty, no secret ever
  logged, npm scripts map to real files, DAR filenames consistent.

## Pass 3 — cross-artifact + untouched-surface review, runtime verification

A third reviewer swept the surfaces the first two didn't (deck, recorder, static
UI, and the v0.3.0 diff), and the full Award flow was driven through the UI.

- ✅ **Windows demo was broken.** `demo-local.mjs` spawned the web server via
  `process.execPath` (`C:\Program Files\nodejs\node.exe`) with `shell:true`, so
  the Windows shell split on the space (`'C:\Program' is not recognized`) — the
  sandbox booted but the desk never started. Now spawned with `shell:false`.
- ✅ **Dealer ask input was wiped every 1.8s.** `renderDealer` replaced the panel
  `innerHTML` on every poll, clobbering a half-typed price and focus. Now skips
  re-rendering a panel while one of its inputs is focused.
- ✅ **Award flow verified end-to-end through the UI on v0.3.0** — Vickrey
  second-price settlement, atomic DvP, escrow return, regulator post-trade only.
  `record.mjs` now asserts each concrete state (winner card, awardable button,
  a settled trade) and fails on any error toast instead of screenshotting blind.
- ✅ **Deck / demo-script consistency.** Removed the "Vickrey enforced on-ledger"
  overclaim (the buyer-as-auctioneer curates the quote set); reworded to "the
  Award choice computes the clearing on-ledger". Clarified the team name "Diam"
  vs the first build "Diam" so it doesn't read as a typo.
- ✅ **Responsive desk** — added a `max-width:900px` single-column media query.
- ⚠️ **Issuer binding is only active where issuers are supplied.** `optional True
  (== issuer) None` disables the check, and the UI sends `None` on the local
  sandbox (no server config), so sandbox-created RFQs are unbound. The seeded
  Devnet deployment binds them. A production token standard (CIP-0056) removes
  this fail-open default. Accepted scope, stated plainly.
- ✔ Reviewer confirmed the pass-2 fixes are sound: `DeliverTo`'s dual control
  doesn't deadlock `WithdrawQuote` (buyer authority comes statically from the
  Quote signatory), `Init.daml` is correct, and `record.mjs` selectors match.

## Opportunities (not done — future work)

- CIP-0056 token standard for the cash/asset legs (wallet interop, real DvP).
- Multi-instrument / multi-round RFQ; partial fills.
- WebSocket update stream instead of polling.
- MPC / trusted auctioneer so even the buyer can't see losing bids and the true
  second price is forced (MPC would re-add the cryptography Canton lets us skip).

**Delivered since this review:**
- Direct bilateral OTC as a second settlement mode alongside Vickrey — the buyer's
  "settle one quote at its ask" is now a deliberate feature, not just tolerated scope.
- Per-dealer one-quote enforcement — `Award` rejects a quote set that repeats a
  dealer (`testDuplicateDealerRejected`).
- Partial fills — `Quote.AcceptPartial` settles part of a lot at the prorated ask
  via `EscrowedHolding.DeliverSplit` (remainder returns to the dealer);
  `testPartialFill` checks the exact money math. Also on the Vickrey rail
  (`RFQ.AwardPartial` / `Quote.SettleQuotePartial`, `testPartialVickrey`).
- Multi-instrument baskets (`BasketRFQ`/`BasketQuote`/`BasketTradeReport`,
  `testBasket`), CIP-0056-aligned `Token` interface (`testTokenInterface`), a
  live-seed variant (`npm run demo:cases`, `Init:richSeed`), a "Verify privacy"
  on-ledger proof view, a Portfolio view, and **selective disclosure**
  (`Quote.DiscloseTo` → `QuoteDisclosure`, `testSelectiveDisclosure`) — the buyer
  reveals one sealed quote to an auditor on demand, never to rivals or the public.

**Known scope — Canton smart-contract-upgrade (SCU):** the deployed Devnet package
is **v0.5.0** (`5e851293`). The newest write-path features (`AwardPartial`,
`DiscloseTo`) live in the repo + local demo but were **not redeployed** as a v0.6.0
upgrade: an in-package interface (`Bisik:Token`) changes package id per version, so
Canton's SCU check rejects any same-name `bisik` v0.6.0 as an invalid upgrade of
v0.5.0 ("interface implementation appears in old package but not new"). The proper
fix is to move the interface to a separate, stable package; for the hackathon these
features are demonstrated locally (they're writes, unusable on the read-only hosted
URL anyway). The rich v0.5.0 deployment (15 settled trades, all read views) stays live.
- Live dashboard KPI tiles; functional in-app sidebar nav; Playwright video recorder.
