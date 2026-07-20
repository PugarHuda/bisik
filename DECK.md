# Bisik — pitch deck outline

Build on Canton Hackathon · Private DeFi & Capital Markets. ~11 slides.
(Authoritative deck: `slides/index.html` → `slides/bisik-deck.pdf`. This is the outline.)

---

**1 · Title**
Bisik — *you whisper quotes, the market hears nothing.*
A confidential multi-dealer RFQ desk for OTC block trades, native on Canton.
Solo builder · team "Diam".

**2 · The problem**
Institutions can't trade size in the open. Post a $4M block on a public venue →
the order and the competing bids leak → front-running, market impact, leaked
alpha. Today's fix is OTC desks and chat rooms that require trusting a middleman
and leave no clean audit trail. $30B+/month still trades this way.

**3 · What Bisik is**
An on-chain RFQ desk where a buyer requests quotes from a chosen dealer panel;
each dealer's quote is *sealed* — rivals never receive it — the fair price is a
Vickrey (second-price) clearing, and settlement is atomic delivery-versus-payment.
Confidential pre-trade, auditable post-trade.

**4 · The demo (screenshot: 3-column desk)**
One Canton ledger, three party views. Dealer A whispers a quote → Dealer B's
column stays empty. Not UI hiding — the quote is never sent to B's node.

**5 · How it works (the diagram)**
```
RFQ (buyer → invited dealers, no price)
  → each dealer locks asset into escrow + seals a Quote (signatory dealer+buyer)
    → Buyer Awards: cheapest ask wins, paid the 2nd price, atomic DvP
      → losing quotes archived, never revealed
        → TradeReport visible to the regulator (post-trade only)
```
Privacy = Canton sub-transaction privacy. Fairness = the Vickrey rule computed
in the `Award` choice on-ledger (not a trusted operator). Settlement = atomic
DvP — both legs or neither. The contract also guarantees no dealer is paid below
their ask and that escrowed collateral can't be pulled back mid-auction.

**6 · Provable best execution (the institutional payoff)**
A public exchange audits best execution against a visible order book. Bisik has
none — pre-trade stays confidential — yet the regulator still proves it: either
side can *selectively disclose* a sealed ask to the regulator on demand (never to
rivals), and the desk confirms the winner quoted the lowest ask and the buyer paid
no worse than any competitor. **Live on Devnet: 10 green attestations across all
three rails** (Vickrey, direct OTC, partial fill). Confidential pre-trade, *provable*
post-trade. [Screenshot: the Best-execution view.]

**7 · Why Canton — the differentiator (the table)**
I built this exact product four times before, each fighting the chain's
transparency:

| Build | Chain | Privacy machinery |
|---|---|---|
| Diam | iExec Nox | TEE confidential compute |
| Segel | Stellar | two Groth16 ZK circuits |
| Sealed Pair | Sui | Walrus + Seal |
| Samar | Zama fhEVM | fully-homomorphic encryption |
| **Bisik** | **Canton** | **none — it's the ledger model** |

On Canton, "rivals can't see the quote" is `signatory`/`observer`. ~40 lines of
Daml replaces thousands of lines of cryptography. This is the case *for* Canton,
made by someone who tried the alternatives.

**8 · Real-world fit**
RFQ is how Tradeweb / Bloomberg actually run OTC — and Tradeweb is a Canton Super
Validator. Bisik is that institutional workflow, native, with privacy guaranteed
by the protocol and a regulator-observable audit trail. Maps to the track's
"OTC trading workflows" and "credible relevance to institutional markets."

**9 · Technical execution**
- Clean two-package Daml (model DAR carries no test/script bloat).
- Escrow-backed atomic DvP; reverse-Vickrey clearing computed on-ledger in `Award`.
- End-to-end `daml test` incl. explicit privacy assertions (Dealer B cannot
  query Dealer A's quote).
- Web desk over the JSON Ledger API; verified live against a Canton participant.
- Deployed on Canton Devnet.

**10 · Honest scope / roadmap**
Shipped: three settlement rails (competitive Vickrey + direct bilateral OTC + partial
fills on both); one-quote-per-dealer enforced on-ledger; multi-instrument baskets;
symmetric selective disclosure; provable best execution across all three rails; two
autonomous market-maker agents settling a real trade; an MCP write tool an AI drives
to post an RFQ; and a **CIP-0056-shaped token standard live on Devnet** (Holding +
two-step TransferInstruction + atomic-DvP Allocation + Metadata).
Ahead: full external-wallet registry interop for the token standard (the Splice
TransferFactory/AllocationFactory DARs); and — to force the true second price even
against a self-interested buyer — a trusted auctioneer or MPC (the latter would
re-introduce exactly the cryptography Canton lets us skip).

**11 · Close**
Bisik. The confidential OTC desk that finally didn't need a cryptography stack —
because Canton already is one. *Live on Devnet · github.com/PugarHuda/bisik · bisik-eight.vercel.app*
