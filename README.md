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
                         — the market never sees it; the RFQ carries no price
choice   SubmitQuote     dealer locks the asset into escrow + seals a quote
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
daml/Bisik.daml           model — the whole product (bisik-0.1.0.dar → deploy this)
test/daml/BisikTest.daml  end-to-end script + privacy assertions
test/daml/Init.daml       on-ledger seed: parties + an open RFQ (LocalNet/Devnet demo)
web/                      the desk UI: 3 party views + JSON Ledger API proxy (Node stdlib)
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
daml sandbox --dar .daml/dist/bisik-0.1.0.dar --json-api-port 7575
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
daml build --all    # bisik-0.1.0.dar (model) + bisik-test-0.1.0.dar
cd test && daml test # testBisik: mint → RFQ → sealed quotes → Vickrey DvP
                     # + privacy assertions (dealer B cannot query dealer A's quote)
```

## Deployed live on Canton Devnet ✅

Running on the shared 5N hackathon validator (Canton **3.5.7**), via the JSON
Ledger API. A one-file deployer (`scripts/devnet.mjs`, Node stdlib) uploads the
DAR, allocates + grants parties, and seeds a live RFQ with two sealed quotes.

```bash
cp scripts/.env.devnet.example scripts/.env.devnet   # fill client secret (Encode #general)
node scripts/devnet.mjs upload .daml/dist/bisik-0.1.0.dar
node scripts/devnet.mjs seed        # parties + holdings + RFQ + 2 sealed quotes
node scripts/devnet.mjs verify      # prints per-party visibility (the privacy proof)
# then serve the UI against Devnet (token auto-injected by the proxy):
cd web && LEDGER_JSON_URL=https://ledger-api.validator.devnet.sandbox.fivenorth.io \
  LEDGER_USER_ID=6 LEDGER_TOKEN_URL=… LEDGER_CLIENT_ID=… LEDGER_CLIENT_SECRET=… \
  LEDGER_AUDIENCE=validator-devnet-m2m LEDGER_SCOPE=daml_ledger_api npm start
```

**Live deployment facts**
- Ledger API: `https://ledger-api.validator.devnet.sandbox.fivenorth.io`
- Model package id: `906f2697a2d0db695c3cf6ad8b28d8960507cd18ca08689f4e995013fb3add3f`
- Parties (shared namespace `…::1220a14ca128…`): `bisik-buyer-1`, `bisik-dealerA-1`,
  `bisik-dealerB-1`, `bisik-regulator-1`, `bisik-cashissuer-1`, `bisik-bondissuer-1`
- On-ledger `verify` result — Dealer A and Dealer B each see **only their own**
  Quote; the Regulator sees nothing pre-trade. Privacy proven on Devnet, not sandbox.

`verify` on Devnet prints:
```
buyer      {"Holding":2,"RFQ":1,"EscrowedHolding":2,"Quote":2} quotes from: bisik-dealerA,bisik-dealerB
dealerA    {"Holding":1,"RFQ":1,"EscrowedHolding":1,"Quote":1} quotes from: bisik-dealerA
dealerB    {"Holding":1,"RFQ":1,"EscrowedHolding":1,"Quote":1} quotes from: bisik-dealerB
regulator  {}
```

## Honest scope

- **Quote completeness is buyer-attested**: the buyer chooses which quotes to include in `Award` (like a real RFQ desk — best execution is a policy question, not enforced on-ledger). The Vickrey *pricing rule itself* is contract-enforced over the included set.
- Simple self-contained `Holding` token, not CIP-0056 — the token standard is the stated next step.
- Single-round sealed bids; no partial fills. One instrument per RFQ.

## License

Apache-2.0
