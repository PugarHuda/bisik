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
  `clearingPrice >= dealer ask`. The dealer is never paid **below its own ask**
  (guarded by `clearingPrice >= price`); the buyer can, however, curate the awarded
  quote set to clear at the winner's ask rather than the true second price — i.e.
  suppress the Vickrey uplift, not underpay the dealer. `Award` is the fair path.
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
  and DvP atomicity; the buyer can suppress the Vickrey uplift (clear at the
  winner's own ask) but never underpay a dealer. Forcing true second-price /
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

- **Full CIP-0056 token standard** for the cash/asset legs (external-wallet interop).
  A CIP-0056-aligned in-package `Token` interface already ships; adopting the full
  standard DARs is a package change, so it's deferred to keep the live Devnet package
  id (`b0058535…`) frozen for this submission.
- **MPC / trusted auctioneer** so even the buyer can't see losing bids and the *true*
  second price is forced against a self-interested buyer. Deliberately declined: MPC
  re-adds exactly the cryptography Canton lets us skip; a trusted auctioneer moves the
  trust off-ledger. The on-ledger guarantee stands at "at or above the winner's ask."

*Previously listed here and now shipped:* multi-instrument / multi-round RFQ and
partial fills (baskets + `AcceptPartial`/`AwardPartial` + withdraw/re-quote); and the
"WebSocket update stream" — the desk now gets **SSE push** the moment the ledger offset
moves (`/api/stream` in `web/server.mjs`), not blind timer polling.

**Delivered since this review:**
- **Agentic write path** — the MCP server gained `post_rfq`: an AI agent initiates a
  real commercial action (posts a confidential RFQ on-ledger, sealed per dealer) using
  the operator's local credentials, verified live on Devnet. And `scripts/agent.mjs`
  runs a **full two-agent round-trip** — two dealer-agents quote blind, a buyer-agent
  awards, and a real Vickrey-cleared `TradeReport` settles on Devnet.
- Direct bilateral OTC as a second settlement mode alongside Vickrey — the buyer's
  "settle one quote at its ask" is now a deliberate feature, not just tolerated scope.
- Per-dealer one-quote enforcement — `Award` rejects a quote set that repeats a
  dealer (`testDuplicateDealerRejected`).
- Partial fills — `Quote.AcceptPartial` settles part of a lot at the prorated ask
  via `EscrowedHolding.DeliverSplit` (remainder returns to the dealer);
  `testPartialFill` checks the exact money math. Also on the Vickrey rail
  (`RFQ.AwardPartial` / `Quote.SettleQuotePartial`, `testPartialVickrey`).
  *Known rounding nuance:* `fillPay = clearingPrice * fillQuantity / quantity` rounds
  to `Numeric 10`, so a non-divisible fill can under-pay the dealer by ≤~5e-11 (buyer's
  favour) while the asset leg is exact — negligible at Decimal precision; a real
  deployment wanting the dealer made whole would round `fillPay` up. (Not patched in
  the model: editing `daml/Bisik.daml` shifts LF source spans and changes the deployed
  package id `b0058535…`, so the source is frozen to match live Devnet.)
- Multi-instrument baskets (`BasketRFQ`/`BasketQuote`/`BasketTradeReport`,
  `testBasket`), CIP-0056-aligned `Token` interface (`testTokenInterface`), a
  live-seed variant (`npm run demo:cases`, `Init:richSeed`), a "Verify privacy"
  on-ledger proof view, a Portfolio view, and **selective disclosure**
  (`Quote.DiscloseTo` → `QuoteDisclosure`, `testSelectiveDisclosure`) — the buyer
  reveals one sealed quote to an auditor on demand, never to rivals or the public.

**Canton smart-contract-upgrade (SCU) — solved by fresh package lineage:** the
in-package `Bisik:Token` interface changes package id per version, so Canton's SCU
check refuses to upgrade a same-name `bisik` package (`NOT_VALID_UPGRADE_PACKAGE`).
The fix shipped: **rename the package to `bisik-otc` (v0.6.0)** — a new name is a new
upgrade lineage, not an in-place upgrade, so the check never applies. The module
stays `Bisik`, so template ids and the package-agnostic UI are unchanged. **v0.6.0 is
now live on Devnet** (package `b0058535…`, parties `bisik-v6-*`): symmetric
disclosure (`DealerDiscloseTo`), partial-Vickrey (`AwardPartial`), and every other
write choice deploy on-ledger. All are surfaced in the desk UI and driven end-to-end
by Playwright — three suites clicking every choice the model exposes (`npm run e2e`
20/20 + `npm run e2e:actions` 16/16 + `npm run e2e:bestexec` 8/8). **What CI gates:**
the 27 Daml behavioural scripts (`daml test`) + JS syntax + the read-only proxy
self-check run on every push; the Playwright suites need a live sandbox + browser, so
they're run locally (not in CI). The rich deployment (settled trades across
Treasuries/Gilts/Bunds/JGB/OAT/corporates/EM + baskets, all read views) stays live.
- Live dashboard KPI tiles; functional in-app sidebar nav; Playwright video recorder.
