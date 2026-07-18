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
  regulator-observable TradeReport. **Two settlement modes on the same sealed
  rails:** competitive reverse-Vickrey Award (cheapest wins, paid the 2nd price)
  *and* direct bilateral OTC (buyer hits one dealer at its firm ask), with
  **partial fills** (settle part of a lot at the prorated ask). Escrow-backed
  (dealer can't pull collateral mid-auction), issuer-bound, RFQ-bound quotes,
  time-boxed RFQs.
- **Web desk** — three party views of one ledger over the JSON Ledger API; watch a
  dealer quote and the rival's column stay empty. A **Portfolio** view (holdings per
  party) and an **Audit trail** view (the regulator's settled record).
- **"Verify privacy" — a live on-ledger proof.** One click counts what each party's
  participant node *actually holds*: each dealer sees only its own sealed quotes
  (rivals: 0), the regulator sees zero pre-trade. Not UI filtering — the ledger never
  transmits it. Turns the privacy claim into something a judge can check.
- **Selective disclosure — "users control who sees what," literally.** The buyer can
  reveal *one* sealed quote to a chosen auditor (the regulator) on demand — for a
  best-execution audit or a dispute — without ever making it public or sending it to
  rival dealers (`Quote.DiscloseTo`). Canton's real superpower, and an angle most
  privacy demos miss. Drive it in `npm run demo` (a write, so disabled on the read-only
  hosted URL).
- **MCP server** — the desk as AI-native tools; an agent can *verify Canton's
  privacy itself* (`party_view(dealerA)` returns only its own quote).
- **Autonomous market-maker agent** — a software agent that watches for RFQs it's
  invited to and auto-quotes, blind to its rivals.
- **17 behavioural tests (+ seed scripts, 22 total), CI, deployed live on Canton Devnet.**

## Why Canton (the differentiator)
We built this exact product four times before — iExec (TEE), Stellar (ZK circuits),
Sui (Walrus + Seal), Ethereum (FHE) — each time most of the code fought the chain's
transparency. On Canton that machinery disappears: the privacy we need is the
ledger's data model. This is the case *for* Canton, made by someone who tried the
alternatives.

## How it maps to the judging criteria
- **Technical execution** — clean two-package Daml; 17 behavioural tests (privacy, Vickrey 1/2/3,
  escrow guard, issuer binding, cross-RFQ, deadline, one-quote-per-dealer, partial fills both modes, baskets, token interface, selective disclosure); CI; deployed + verified on Devnet.
- **Originality** — an agent that verifies the ledger's privacy for itself; a desk
  built five times that finally needed no cryptography stack.
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
- **3 · Payments, Neobanking & Agentic Commerce** — an **MCP server** exposes the desk as
  AI-native tools and an **autonomous market-maker agent** initiates commercial actions
  (auto-quotes RFQs it's invited to, blind to rivals) — a software agent transacting safely
  under Canton's privacy model.

## Links
- Repository: https://github.com/PugarHuda/bisik
- Live product: **https://bisik-eight.vercel.app** — hosted read-only desk over
  live Canton Devnet state (three party views prove the privacy model; actions are
  disabled on the public URL). Full interactive: `npm run demo` (local).
- Deployed on Canton Devnet: package `5e851293…`, parties `bisik-v5-*` on the shared
  5N validator (`https://ledger-api.validator.devnet.sandbox.fivenorth.io`); the
  contracts are also visible in Seaport's contract explorer for the encode-hackathon org.
- Demo video: _(record from `DEMO-VO.md` — read-aloud 3-min script — then paste the link here)_.
  Visual assets to narrate over: **`media/bisik-pitch.mp4`** (a 39s animated Remotion
  pitch, `video/`) and **`media/bisik-demo-full.webm`** (a screen-driven desk B-roll).
  Encode requires the presenter's own voice, so these are the visuals — record narration on top.
- Deck: **`slides/bisik-deck.pdf`** (10 slides, pre-rendered) · source `slides/index.html`

## How judges try it

**1 · Fastest — nothing to install (~30s).** Open **https://bisik-eight.vercel.app**
→ *Open the desk*. You see three party lenses on the **live Canton Devnet** ledger: the
buyer holds the sealed quotes, each dealer sees only its own, and the regulator audits a
**spread of real settled trades** — Vickrey, direct OTC, a partial fill, and a
multi-instrument basket, across Treasuries, Gilts, Bunds and corporates. That blindness
is the ledger model, not UI hiding — proof the contracts are running on Devnet with real
sub-transaction privacy.

> The public desk is **read-only by design**: it proxies *reads* to Devnet with the
> validator token kept server-side and blocks every write, so a public URL can never
> drive the shared validator. To click the flow yourself, run it locally ↓ — or watch
> the 3-min video, which drives the full award end-to-end.

**2 · Full interactive (local, one command).**
```bash
daml build --all && cd test && daml test   # 22 scripts green (incl. privacy + Vickrey + a settled trade)
npm run demo                                # sandbox → seed → desk at http://localhost:8080
#   → open http://localhost:8080, create an RFQ, quote as both dealers, Award (Vickrey)
npm run agent:demo                          # the autonomous market-maker quotes an RFQ
cd mcp && npm install && npm start          # the desk as read-only MCP tools for an AI agent
```

**3 · Verify the Devnet privacy claim directly.** `npm run devnet:verify` prints each
party's on-ledger contract counts — dealers see only their own quote, regulator nothing
pre-trade. Full Devnet deploy steps in `README.md`; the multi-angle QA record in `QA.md`.

## Submission checklist
- [x] Public repository — github.com/PugarHuda/bisik
- [x] Deployed live on Canton Devnet (not LocalNet) — verified on-ledger
- [x] Link to live product — **https://bisik-eight.vercel.app** (hosted, read-only over live Devnet) + `npm run demo`
- [x] Presentation deck — `slides/bisik-deck.pdf` (10 slides)
- [ ] 3-minute video pitch + demo — **record with your own voice** (Encode rule);
      read-aloud script in `DEMO-VO.md`, storyboard in `DEMO-SCRIPT.md`, captures in `media/`

Deadline: **Sunday 19 July 2026, midnight in your local timezone (WIB)** — extended by Encode Club.
