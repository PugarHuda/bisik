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
daml/Bisik.daml        model — the whole product (bisik-0.1.0.dar → deploy this)
test/daml/BisikTest.daml  end-to-end script + privacy assertions
test/daml/Init.daml       on-ledger seed: parties + an open RFQ (LocalNet/Devnet demo)
multi-package.yaml     workspace
```

## Run it

```bash
daml build --all    # bisik-0.1.0.dar (model) + bisik-test-0.1.0.dar
cd test && daml test # testBisik: mint → RFQ → sealed quotes → Vickrey DvP
                     # + privacy assertions (dealer B cannot query dealer A's quote)
```

## Deploy to Canton Devnet

```bash
daml build --all
# upload the model DAR to your validator's JSON Ledger API
#   POST /v2/packages   (bisik-0.1.0.dar)
# then seed a live RFQ + holdings against the participant:
daml script --dar test/.daml/dist/bisik-test-0.1.0.dar \
  --script-name Init:initialize \
  --ledger-host <devnet-participant> --ledger-port <port>
```

Devnet needs a Super Validator sponsor + VPN (self-service on Devnet). Party IDs printed by `Init` go into the frontend `.env`.

- **Deployed party/contract IDs**: _(added on deploy)_

## Honest scope

- **Quote completeness is buyer-attested**: the buyer chooses which quotes to include in `Award` (like a real RFQ desk — best execution is a policy question, not enforced on-ledger). The Vickrey *pricing rule itself* is contract-enforced over the included set.
- Simple self-contained `Holding` token, not CIP-0056 — the token standard is the stated next step.
- Single-round sealed bids; no partial fills. One instrument per RFQ.

## License

Apache-2.0
