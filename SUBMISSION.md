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
- **Confidential RFQ desk in Daml** — RFQ → sealed Quote → reverse-Vickrey Award →
  atomic DvP → regulator-observable TradeReport. Escrow-backed (dealer can't pull
  collateral mid-auction), issuer-bound, RFQ-bound quotes, time-boxed RFQs.
- **Web desk** — three party views of one ledger over the JSON Ledger API; watch a
  dealer quote and the rival's column stay empty.
- **MCP server** — the desk as AI-native tools; an agent can *verify Canton's
  privacy itself* (`party_view(dealerA)` returns only its own quote).
- **Autonomous market-maker agent** — a software agent that watches for RFQs it's
  invited to and auto-quotes, blind to its rivals.
- **14 behavioural tests, CI, deployed live on Canton Devnet.**

## Why Canton (the differentiator)
We built this exact product four times before — iExec (TEE), Stellar (ZK circuits),
Sui (Walrus + Seal), Ethereum (FHE) — each time most of the code fought the chain's
transparency. On Canton that machinery disappears: the privacy we need is the
ledger's data model. This is the case *for* Canton, made by someone who tried the
alternatives.

## How it maps to the judging criteria
- **Technical execution** — clean two-package Daml; 14 tests (privacy, Vickrey 1/2/3,
  escrow guard, issuer binding, cross-RFQ, deadline); CI; deployed + verified on Devnet.
- **Originality** — an agent that verifies the ledger's privacy for itself; a desk
  built five times that finally needed no cryptography stack.
- **UX** — a three-column desk that *shows* the privacy (rival column stays blank).
- **Real-world applicability** — multi-dealer RFQ is the Tradeweb/Bloomberg OTC
  workflow; Tradeweb is a Canton Super Validator. Time-boxed, issuer-bound, DvP,
  regulator-auditable.

## Links
- Repository: https://github.com/PugarHuda/bisik
- Live product: run `npm run demo` (local) or point the desk at Devnet (README)
- Deployed on Canton Devnet: package `bf5d9a45…`, parties `bisik-v4-*` on the shared
  5N validator (`https://ledger-api.validator.devnet.sandbox.fivenorth.io`); the
  contracts are also visible in Seaport's contract explorer for the encode-hackathon org.
- Demo video: _(add your 3-min narrated video link)_
- Deck: `slides/index.html` (open in a browser; print → PDF)

## How to run (for judges)
```bash
daml build --all && cd test && daml test   # 14 tests green
npm run demo                                # one command: sandbox → seed → desk :8080
npm run agent:demo                          # the autonomous market-maker quotes an RFQ
cd mcp && npm install && npm start          # the desk as MCP tools
```
Full Devnet deploy + verify steps and the privacy proof are in `README.md`; the
multi-angle QA record is in `QA.md`.

## Submission checklist
- [x] Public repository — github.com/PugarHuda/bisik
- [x] Deployed live on Canton Devnet (not LocalNet) — verified on-ledger
- [x] Link to live product — `npm run demo` / Devnet-pointed desk
- [x] Presentation deck — `slides/index.html`
- [ ] 3-minute video pitch + demo — **record with your own voice** (Encode rule);
      storyboard in `DEMO-SCRIPT.md`, silent capture in `media/`
