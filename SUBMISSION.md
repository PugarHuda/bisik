# Bisik — submission

Ready-to-paste answers for the Encode / DoraHacks submission form.
Team: **Diam** (solo — Pugar Huda Mantoro). Track: **Private DeFi & Capital Markets**
(also touches **Payments, Neobanking & Agentic Commerce** via the MCP + agent).

---

## Tagline
You whisper quotes. The market hears nothing. — a confidential multi-dealer RFQ OTC desk, native on Canton.

## One-paragraph summary
Bisik is an on-chain over-the-counter desk for large block trades where dealer
quotes are genuinely sealed. A buyer requests quotes from a chosen dealer panel;
each dealer's quote is visible only to that dealer and the buyer — rival dealers
never receive it, because Canton's sub-transaction privacy never sends it to their
node (it isn't UI-hidden, it's never transmitted). The cheapest ask wins and is
paid the second price (reverse Vickrey), settled atomically delivery-versus-payment.
A regulator observes executed trades and nothing else: confidential pre-trade,
auditable post-trade. On any transparent chain this needs ZK or FHE; on Canton the
whole privacy layer is a `signatory`/`observer` declaration in ~40 lines of Daml.

## The problem
Institutions can't trade size in the open — post a $4M block on a public venue and
the order and the competing bids leak, inviting front-running and market impact.
Today's fix is OTC desks and chat rooms that require trusting a middleman and leave
no clean audit trail. $30B+/month still trades this way.

## What we built
- **Confidential RFQ desk in Daml** — RFQ → sealed Quote → atomic DvP →
  regulator-observable TradeReport. **Three settlement rails on the same sealed
  quotes:** competitive reverse-Vickrey Award (cheapest wins, paid the 2nd price),
  direct bilateral OTC (buyer hits one dealer at its firm ask), and **partial fills
  on both** (settle part of a lot at the prorated price). Escrow-backed (dealer can't
  pull collateral mid-auction), issuer-bound, RFQ-bound quotes, time-boxed RFQs.
- **Provable best execution — without any public order book.** *(the marquee)* A
  public exchange audits best execution against a visible book; Bisik has none — the
  pre-trade stays confidential — yet the regulator still proves it. From the sealed
  asks the counterparties selectively disclose to it, the desk confirms the winner
  quoted the lowest ask and the buyer paid no worse than any competitor. **Live on
  Devnet: 16 green attestations across all three rails** (Vickrey, direct OTC, partial
  fill) and asset classes. Confidential pre-trade, *provable* post-trade — the
  institutional payoff, in a dedicated **Best execution** view and an MCP tool.
- **Web desk** — three party views of one ledger over the JSON Ledger API; watch a
  dealer quote and the rival's column stay empty. A **Portfolio** view (holdings per
  party) and an **Audit trail** view (the regulator's settled record).
- **"Verify privacy" — a live on-ledger proof.** One click counts what each party's
  participant node *actually holds*: each dealer sees only its own sealed quotes
  (rivals: 0), the regulator sees zero pre-trade. Not UI filtering — the ledger never
  transmits it. Turns the privacy claim into something a judge can check.
- **Selective disclosure — "users control who sees what," literally.** *Either side*
  of a trade can reveal *one* sealed quote to a chosen auditor on demand — the buyer
  for a best-execution audit (`Quote.DiscloseTo`), or the dealer for a fair-pricing /
  dispute defence (`Quote.DealerDiscloseTo`) — without ever making it public or sending
  it to rivals. This is the primitive the best-execution proof is built on, and an
  angle most privacy demos miss.
- **"What a transparent chain would leak" — a live contrast.** The Verify-privacy view
  quantifies, right now, what a public L1 would be exposing in its mempool (live quotes
  + RFQs) versus what Canton actually transmits to a non-counterparty (zero), and maps
  each leak to the cryptography our four earlier builds needed (TEE/ZK/Seal/FHE).
- **MCP server** — the desk as AI-native tools; an agent can *verify Canton's privacy
  itself* (`party_view(dealerA)` returns only its own quote) and *audit best execution*
  (`best_execution` attests each settled trade against the disclosed asks).
- **Autonomous market-maker agents** — software agents that watch for RFQs they're
  invited to and auto-quote, blind to their rivals. The demo runs a full round-trip
  between agents (two dealers quote, a buyer-agent awards) that settles a real
  Vickrey-cleared `TradeReport` on Devnet — no human sets the price.
- **A CIP-0056-shaped token standard, live on Devnet** — its own package (`bisik-token`,
  `d969c045…`): a `Holding` interface with a real lock, a **two-step `TransferInstruction`**
  (propose → accept/reject/withdraw, with expiry so funds are never stranded), and an
  **`Allocation` + `DvpSettlement`** that settles two legs in one transaction — neither side
  can claim a leg unilaterally. Verified on-ledger, not just compiled.
- **Every model choice is drivable in the UI, and everything is tested.** **36 Daml
  behavioural scripts** across a CI-gated four-package workspace, plus **143 automated
  checks**: five suites driving the real desk (`e2e` 22/22 · `e2e:actions` 16/16 ·
  `e2e:bestexec` 8/8), the **live hosted build across Chromium, Firefox and WebKit**
  (`e2e:hosted` 66/66), and the **MCP server over real JSON-RPC** (`e2e:mcp` 25/25),
  plus a read-only-proxy self-check (6/6). Deployed live on Canton Devnet.

## Why Canton (the differentiator)
We built this exact product four times before — iExec (TEE), Stellar (ZK circuits),
Sui (Walrus + Seal), Ethereum (FHE) — each time most of the code fought the chain's
transparency. On Canton that machinery disappears: the privacy we need is the
ledger's data model. This is the case *for* Canton, made by someone who tried the
alternatives.

## How it maps to the judging criteria
- **Technical execution** — a clean four-package Daml workspace; 36 behavioural scripts (privacy, Vickrey 1/2/3,
  escrow guard, issuer binding, cross-RFQ, deadline, one-quote-per-dealer, partial fills both rails, baskets, token interface, symmetric selective disclosure, plus the token standard's transfer/expiry/lock/atomic-DvP cases) + 143 automated checks including cross-browser and MCP suites; CI; deployed + verified on Devnet. Adversarial QA caught and fixed real defects — a unilaterally-revocable escrow, a counterfeit-asset path, and a DvP leg that could be claimed one-sidedly — each now a named regression test.
- **Originality** — provable best execution with no public order book; an agent that
  verifies the ledger's privacy for itself; a desk built five times that finally needed
  no cryptography stack.
- **UX** — a three-column desk that *shows* the privacy (rival column stays blank).
- **Real-world applicability** — multi-dealer RFQ is the Tradeweb/Bloomberg OTC
  workflow; Tradeweb is a Canton Super Validator. Time-boxed, issuer-bound, DvP,
  regulator-auditable.

## Track fit — Bisik spans all three
Prizes are awarded to the top 3 *across all tracks*, and Bisik is deliberately built to land in each:
- **1 · Private DeFi & Capital Markets** *(primary)* — a confidential multi-dealer RFQ / OTC
  block-trading desk; sealed pricing, hidden counterparties, sealed positions. Exactly the
  track's "OTC trading workflows" and "capital markets tools where pricing/counterparties
  shouldn't be public."
- **2 · TradeFi, RWA & Tokenized Assets** — every leg is a tokenized real-world asset:
  US Treasuries (2Y/5Y/10Y/30Y), UK Gilts, German Bunds, French OAT, Japanese JGB,
  corporate bonds (Apple/Microsoft/Alphabet/Tesla/JPMorgan), EM sovereigns (Mexico/Brazil),
  settled against tokenized USD cash — atomic DvP, issuer-bound. Real instruments, real settlement.
  On top of that, a **CIP-0056-shaped token standard is deployed and verified on Devnet**
  (`Holding` + two-step `TransferInstruction` + `Allocation`-based atomic DvP), so the
  tokenization is a standard-shaped primitive, not a bespoke one-off.
- **3 · Payments, Neobanking & Agentic Commerce** — an **MCP server** exposes the desk as
  AI-native tools and **autonomous market-maker agents** coordinate a complete commercial
  action end-to-end: two dealer-agents quote blind to rivals, a buyer-agent awards, and the
  trade settles at the Vickrey price as a real on-Devnet `TradeReport` — software agents
  transacting safely under Canton's privacy model, with no human in the pricing loop.

## Links
- Repository: https://github.com/PugarHuda/bisik
- Pitch deck: **https://bisik-eight.vercel.app/deck** (13 slides · PDF at `/deck.pdf`)
- Live product: **https://bisik-eight.vercel.app** — hosted read-only desk over
  live Canton Devnet state (three party views prove the privacy model; actions are
  disabled on the public URL). Full interactive: `npm run demo` (local).
- Deployed on Canton Devnet: package `b0058535…`, parties `bisik-v6-*` on the shared
  5N validator (`https://ledger-api.validator.devnet.sandbox.fivenorth.io`); the
  contracts are also visible in Seaport's contract explorer for the encode-hackathon org.
- Demo video: _(record from `DEMO-VO.md` — read-aloud 3-min script — then paste the link here)_.
  Visual assets to narrate over: **`media/bisik-pitch.mp4`** (a 39s animated Remotion
  pitch, `video/`) and **`media/bisik-demo-full.webm`** (a screen-driven desk B-roll).
  Encode requires the presenter's own voice, so these are the visuals — record narration on top.
- Deck: **[bisik-eight.vercel.app/deck](https://bisik-eight.vercel.app/deck)** (13 slides) · PDF **`slides/bisik-deck.pdf`** (also at `/deck.pdf`) · source `slides/index.html`

## How judges try it

**1 · Fastest — nothing to install (~30s).** Open **https://bisik-eight.vercel.app**
→ *Open the desk*. You see three party lenses on the **live Canton Devnet** ledger: the
buyer holds the sealed quotes, each dealer sees only its own, and the regulator audits a
**spread of real settled trades** — Vickrey, direct OTC, a partial fill, and a
multi-instrument basket, across Treasuries, Gilts, Bunds and corporates. That blindness
is the ledger model, not UI hiding — proof the contracts are running on Devnet with real
sub-transaction privacy. Then open the **Best execution** view in the sidebar: **10
green "attested" cards** prove, on live Devnet data, that the buyer beat every disclosed
competing ask — across all three settlement rails, with no public order book anywhere.
The **Verify privacy** view adds a live count of what a transparent chain would have
leaked instead (zero, here).

> The public desk is **read-only by design**: it proxies *reads* to Devnet with the
> validator token kept server-side and blocks every write, so a public URL can never
> drive the shared validator. To click the flow yourself, run it locally ↓ — or watch
> the 3-min video, which drives the full award end-to-end.

**2 · Full interactive (local, one command).**
```bash
daml build --all && cd test && daml test   # 27 scripts green (incl. privacy + Vickrey + a settled trade)
npm run demo                                # sandbox → seed → desk at http://localhost:8080
#   → open http://localhost:8080, create an RFQ, quote as both dealers, Award (Vickrey)
npm run agent:demo                          # the autonomous market-maker quotes an RFQ
cd mcp && npm install && npm start          # the desk as MCP tools for an AI agent (post_rfq writes)
```

**3 · Verify the Devnet privacy claim directly.** `npm run devnet:verify` prints each
party's on-ledger contract counts — dealers see only their own quote, regulator nothing
pre-trade. Full Devnet deploy steps in `README.md`; the multi-angle QA record in `QA.md`.

## Submission checklist
- [x] Public repository — github.com/PugarHuda/bisik
- [x] Deployed live on Canton Devnet (not LocalNet) — verified on-ledger
- [x] Link to live product — **https://bisik-eight.vercel.app** (hosted, read-only over live Devnet) + `npm run demo`
- [x] Presentation deck — live at `/deck`, PDF `slides/bisik-deck.pdf` (13 slides)
- [ ] 3-minute video pitch + demo — **record with your own voice** (Encode rule);
      read-aloud script in `DEMO-VO.md`, storyboard in `DEMO-SCRIPT.md`, captures in `media/`

Deadline: **Sunday 19 July 2026, midnight (WIB)** — the dashboard countdown resolves to
**Mon 20 July, 18:59 WIB**; treat the earlier as the target. Extended by Encode Club.
