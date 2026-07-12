# Bisik — 3-minute demo video storyboard

> Record a real person narrating. The money shot is one screen: three columns,
> Dealer B's column staying empty while Dealer A whispers a quote.

**Setup before recording:** run the local demo (README → Live demo), or point the
UI at Devnet. Have the three-column desk open in one browser window. Have the
Sepolia-equivalent — the Canton Devnet participant / a ledger explorer — in a
second tab if deploying live.

---

### 0:00–0:25 — The problem (talking head or slide)
"When an institution wants to trade a large block — say $4 million of a 30-year
bond — they can't just post it. The moment the order or the competing bids are
visible, the market front-runs them. So block trading hides in OTC desks and
chat rooms you have to trust. Bisik is an on-chain OTC desk where the bids are
genuinely sealed — and the fairness is enforced, not promised."

### 0:25–0:45 — What you're looking at (screen: the desk)
"One Canton ledger, three views. Buyer on the left, two competing dealers on the
right. Each column is what that party's own validator node actually receives —
this isn't UI hiding, it's the ledger."

### 0:45–1:30 — THE MONEY SHOT (screen: live)
- Buyer: "Send to dealer panel" → an RFQ for 1,000 TBOND30. "No price on it —
  just a request to a chosen panel. The market never sees this."
- Dealer A: type an ask (4,210,000) → "Whisper sealed quote."
- **Point at Dealer B's column.** "Watch Dealer B. Dealer A just quoted…
  and nothing appeared. Dealer B's node never received it. On a public chain the
  bid would sit in the mempool. Here it does not exist for the rival."
- Dealer B: quote 4,250,000. "Now B quotes — and A's column doesn't move either."

### 1:30–2:10 — Fair settlement (screen: Buyer + regulator strip)
- Buyer sees both quotes. "Buyer sees the two sealed asks. Cheapest wins —
  but is paid the *second* price. That's a Vickrey auction: it lets dealers quote
  their true price without shading, and the Award choice computes it on-ledger —
  the winner is paid the runner-up's price."
- Click "Award." "One transaction: cash to the winning dealer, the bond to the
  buyer — atomic delivery-versus-payment. If either leg fails, neither happens."
- Balances update: winner paid 4.25M (the second price), loser's bond returned,
  buyer's change 750k. "The losing quote is archived and was never revealed to
  anyone — not the rival, not the public."
- Regulator strip: "And the regulator sees exactly one thing: the executed trade
  at its clearing price. Nothing about the losing bid or the RFQ. Confidential
  pre-trade, auditable post-trade."

### 2:10–2:45 — Why Canton (talking head + the comparison table)
"Here's the part I'm proud of. I built this exact desk four times before — on
iExec with TEEs, on Stellar with two zero-knowledge circuits, on Sui with Seal,
on Ethereum with fully-homomorphic encryption. Every time, most of the code was
machinery fighting the chain's transparency. On Canton that machinery is gone.
'Dealer B can't see Dealer A's quote' is one line: signatory and observer. The
privacy I needed is the ledger's data model."

### 2:45–3:00 — Close (screen: Devnet contracts / repo)
"It's live on Canton Devnet — real Daml contracts, on-ledger. Bisik: you whisper
quotes, the market hears nothing. Thanks."

---

**Shot list checklist**
- [ ] RFQ creation visible
- [ ] Dealer A quote → Dealer B column demonstrably unchanged (hold 3 seconds)
- [ ] Award → balances move, winner paid 2nd price
- [ ] Regulator strip showing only the settled trade
- [ ] Devnet participant / explorer showing the deployed contracts on-ledger
- [ ] The 4-chains-before line delivered to camera (this is the differentiator)
