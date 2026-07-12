# Bisik

> *bisik* — Indonesian for "whisper". You whisper quotes. The market hears nothing.

**Bisik is a confidential multi-dealer RFQ desk for OTC block trades, built native on the Canton Network.** A buyer requests quotes from a chosen dealer panel; each dealer's quote is sealed — competing dealers never receive it, the market never sees the RFQ, and the losing quotes are archived without ever being revealed. Settlement is atomic delivery-versus-payment at a Vickrey (second-price) clearing price. A regulator observes executed trades — and only executed trades.

Built for the **Build on Canton Hackathon** (Encode Club × Canton Foundation, 2026) — Private DeFi & Capital Markets track.

## The fifth implementation — and the first native one

We have built this exact product thesis four times, on four chains, each time fighting the chain's transparency with heavy machinery:

| Project | Chain | Privacy machinery we had to build |
|---|---|---|
| [Diam](https://github.com/PugarHuda/diam) | Arbitrum (iExec Nox) | TEE-based confidential compute, encrypted handles |
| [Segel](https://github.com/PugarHuda/segel) | Stellar (Soroban) | Two Circom/Groth16 ZK circuits, hand-rolled Poseidon |
| [Sealed Pair](https://github.com/PugarHuda/sealed-pair) | Sui | Walrus blob commitments + Seal threshold encryption |
| [Samar](https://github.com/PugarHuda/samar-confidential-otc) | Ethereum (Zama fhEVM) | FHE, branchless `FHE.select` settlement |
| **Bisik** | **Canton** | **None. Sub-transaction privacy is the ledger model.** |

On Canton, "dealer B cannot see dealer A's quote" is not a cryptographic achievement — it is a `signatory`/`observer` declaration. The Daml model below is the entire privacy layer.

## How it works

```
template RFQ             signatory buyer, observer invitedDealers
                         — the market never sees it; no price; optional deadline
choice   SubmitQuote     dealer locks the asset into escrow + seals a quote
                         — rejected once the ledger passes the RFQ's deadline
template Quote           signatory dealer, buyer — NO other observers
                         — competing dealers never RECEIVE it (physically, not by policy)
template EscrowedHolding signatory issuer+dealer, observer buyer
                         — asset locked while the quote is live; dealer can't double-sell
choice   Award           cheapest ask wins, paid the SECOND-cheapest price (Vickrey);
                         atomic DvP: cash→dealer + escrowed asset→buyer in one tx;
                         losing quotes archived + escrow returned, never revealed
template TradeReport     observer regulator — post-trade only; pre-trade stays dark
```

Why Vickrey? Dealers can quote their true reserve price without shading — the winner is paid the runner-up's price. Fair price discovery *requires* sealed bids; on a transparent chain this needs ZK or FHE. Here it is ~40 lines of Daml.

## Layout

Two packages, so the deployable model DAR carries no test/script code:

```
daml/Bisik.daml           model — the whole product (bisik-0.4.0.dar → deploy this)
test/daml/BisikTest.daml  end-to-end script + privacy assertions
test/daml/Init.daml       on-ledger seed: parties + an open RFQ (LocalNet/Devnet demo)
web/                      the desk UI: 3 party views + JSON Ledger API proxy (Node stdlib)
mcp/                      read-only MCP server — the desk as AI-native tools
multi-package.yaml        workspace
```

## Live demo (local ledger)

One command boots a Canton sandbox, seeds it, and serves the desk. Requires the
Daml SDK 3.4 (`daml`), Java 21, and Node ≥ 20.

```bash
npm run demo          # build → sandbox → seed (holdings) → desk at http://localhost:8080
npm run demo:full     # same, but pre-seeds an RFQ + two sealed quotes
npm run record        # drive the money shot with Playwright → media/ screenshots + video
```

<p align="center"><img src="media/03-dealerA-quoted-dealerB-blind.png" width="880"
  alt="Dealer A has quoted; Dealer B's column shows nothing — the quote was never sent to their node" /></p>

Or run the three pieces by hand:

```bash
daml build --all
daml sandbox --dar .daml/dist/bisik-0.4.0.dar --json-api-port 7575
daml script --dar test/.daml/dist/bisik-test-0.1.0.dar \
  --script-name Init:initialize --ledger-host localhost --ledger-port 6865
cd web && npm start
```

The three columns are the same ledger seen by Buyer, Dealer A, and Dealer B.
Watch Dealer B's column while Dealer A whispers a quote: nothing appears — the
quote is never sent to Dealer B's node. Then Buyer awards and the Vickrey price
settles atomically. Point the UI at Devnet instead by setting
`LEDGER_JSON_URL` before `npm start`.

## Run it

```bash
daml build --all    # bisik-0.4.0.dar (model) + bisik-test-0.1.0.dar
cd test && daml test # testBisik: mint → RFQ → sealed quotes → Vickrey DvP
                     # + privacy assertions (dealer B cannot query dealer A's quote)
```

## Deployed live on Canton Devnet ✅

Running on the shared 5N hackathon validator (Canton **3.5.7**), via the JSON
Ledger API. A one-file deployer (`scripts/devnet.mjs`, Node stdlib) uploads the
DAR, allocates + grants parties, and seeds a live RFQ with two sealed quotes.

```bash
cp scripts/.env.devnet.example scripts/.env.devnet   # fill client secret (Encode #general)
node scripts/devnet.mjs upload .daml/dist/bisik-0.4.0.dar
node scripts/devnet.mjs seed        # parties + holdings + RFQ + 2 sealed quotes
node scripts/devnet.mjs verify      # prints per-party visibility (the privacy proof)
# then serve the UI against Devnet — the server reads the gitignored env file, so
# the secret never touches the command line, and binds loopback only:
cd web && LEDGER_ENV_FILE=../scripts/.env.devnet npm start
```

<p align="center"><img src="media/devnet-money-shot.png" width="880"
  alt="The desk reading live Canton Devnet: each dealer sees only its own sealed quote" /></p>
<p align="center"><em>The desk reading live Canton Devnet — real party IDs. Each dealer sees only its own sealed quote.</em></p>

**Live deployment facts**
- Ledger API: `https://ledger-api.validator.devnet.sandbox.fivenorth.io`
- Model package id (`bisik` v0.4.0): `bf5d9a45552353be29cf4180d9cc7465c5fd0f87822b016b9a0da53cba4948f6`
- Parties (shared namespace `…::1220a14ca128…`): `bisik-v4-buyer`, `bisik-v4-dealerA`,
  `bisik-v4-dealerB`, `bisik-v4-regulator`, `bisik-v4-cashissuer`, `bisik-v4-bondissuer`
- On-ledger `verify` result — Dealer A and Dealer B each see **only their own**
  Quote; the Regulator sees nothing pre-trade. Privacy proven on Devnet, not sandbox.

`verify` on Devnet prints:
```
buyer      {"Holding":1,"RFQ":1,"EscrowedHolding":2,"Quote":2} quotes from: bisik-v4-dealerA,bisik-v4-dealerB
dealerA    {"RFQ":1,"EscrowedHolding":1,"Quote":1} quotes from: bisik-v4-dealerA
dealerB    {"RFQ":1,"EscrowedHolding":1,"Quote":1} quotes from: bisik-v4-dealerB
regulator  {}
```

## Agentic access (MCP) — Private DeFi × agentic commerce

Bisik ships a read-only [MCP](https://modelcontextprotocol.io) server (`mcp/`) that
exposes the live desk to AI agents. The compelling part: an agent can **verify
Canton's privacy model for itself**, not take it on faith.

```
agent → party_view("dealerA")  → {"RFQ":1,"EscrowedHolding":1,"Quote":1}  (only its own quote)
agent → party_view("regulator") → {}  (nothing pre-trade)
agent → list_settlements        → the post-trade audit trail
```

Tools: `explain_desk`, `party_view`, `list_settlements`, `market_snapshot` — all
read-only, no signing. Drop `.mcp.json` into Claude Desktop / Cursor, or
`cd mcp && npm install && npm start`. See `mcp/README.md`.

And the *acting* side — an **autonomous market-maker agent** (`scripts/agent.mjs`):
a software agent, acting as a dealer, watches the ledger for RFQs it's invited to
and auto-submits a sealed quote priced by its own rule. It only ever sees its own
invitations (Canton privacy), so it quotes **blind**, like a real market maker —
it can't peek at rival quotes.

```bash
npm run agent:demo   # self-contained: posts an RFQ, the agent detects it and quotes
# → detected RFQ TBOND30 ×1000 → sealed quote 4,242,000 (ref 4,200,000 + 100bps)
```

Together these span two hackathon themes on one confidential ledger: Private DeFi
and agentic commerce with privacy — an agent that both *reads* (verifies privacy)
and *acts* (quotes) on a market where it structurally cannot see its rivals.

## Honest scope

Bisik's buyer is the **auctioneer** — because of the privacy model, only the buyer
sees all the sealed quotes, so only the buyer can run the auction. The contract
enforces the guarantees that protect the *other* parties, and is honest about what
it leaves to the trusted auctioneer:

- **Enforced on-ledger:** rival dealers never receive each other's quotes; a
  winning dealer is never paid below their ask; the asset and cash move atomically
  (DvP) or not at all; the escrowed asset can't be pulled back unilaterally by the
  dealer; a quote can only settle the RFQ it was made against; the asset/cash
  issuer is checked against the RFQ's expected issuers.
- **Left to the buyer (auctioneer):** which quotes to include in `Award`, and thus
  the exact clearing price. A malicious buyer could omit quotes or settle a single
  quote at that dealer's own ask (first price) rather than the Vickrey second price
  — they can only ever *overpay* a dealer, never underpay below the ask. Forcing
  the true second price / full-set inclusion needs a trusted third-party auctioneer
  or MPC (so even the buyer can't see losing bids) — the stated next step.
- Simple self-contained `Holding` token with issuer binding, not CIP-0056 — the
  token standard is the next step.
- Single-round sealed bids; no partial fills; one instrument per RFQ.

See `QA.md` for the full multi-angle review (bugs fixed, accepted scope, opportunities).

## Submission assets

- **Pitch deck** — `slides/index.html` (open in a browser; arrow keys to navigate, print → PDF to export)
- **Demo storyboard** — `DEMO-SCRIPT.md` (3-min video, the money shot beat by beat)
- **Screen capture** — `media/` (per-step screenshots + a silent video to narrate over)
- **Deck outline** — `DECK.md`
- **QA & review notes** — `QA.md` (multi-angle review: bugs fixed, accepted scope, opportunities)

## License

Apache-2.0
