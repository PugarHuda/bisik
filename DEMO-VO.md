# Bisik — 3-minute demo · read-aloud script

Word-for-word narration to **record in your own voice** (Encode disqualifies AI
voice). Read the **plain lines**; the `[bracketed]` lines are what to do on screen,
not spoken. Pace is ~150 words/min → the whole thing lands right around 3:00.

**Before you hit record:** `npm run demo`, wait for `http://localhost:8080`, open it,
click **Open the desk** — this is the interactive tab you drive the flow in. Also open
a **second tab on the live site https://bisik-eight.vercel.app** and leave it on the
desk (that tab is read-only over real Devnet — you switch to it for the close). Its
current live state: one settled **GILT10** trade the regulator can see, plus an open
**TBOND30** RFQ with two sealed quotes — the narration below stays instrument-agnostic
so it matches whatever is on-ledger at record time.

---

## 0:00 – 0:20 · The problem
> When an institution wants to trade a large block — say four million dollars of a
> thirty-year bond — they can't just post it. The moment the order, or the competing
> bids, become visible, the market front-runs them. So block trading hides in OTC
> desks and chat rooms you have to trust. Bisik is an on-chain OTC desk where the
> bids are genuinely sealed — and the fairness is enforced, not promised.

## 0:20 – 0:40 · What you're looking at
[Show the desk — the three columns.]
> One Canton ledger, three views. The buyer on the left, two competing dealers on the
> right. Each column is what that party's own node actually receives. This isn't the
> UI hiding anything — it's the ledger.

## 0:40 – 1:25 · The money shot
[Buyer: click "Send to dealer panel".]
> The buyer opens a request for a thousand thirty-year bonds. There's no price on it —
> just an invitation to a chosen panel. The market never sees this RFQ.

[Dealer A: type 4210000, click "Whisper sealed quote".]
> Dealer A answers with a sealed quote — four point two one million.

[Point at Dealer B's column. Hold for three seconds.]
> Now watch Dealer B. Dealer A just quoted… and nothing appeared. Dealer B's node
> never received it. On a public chain that bid would sit in the mempool for anyone
> to see. Here, for the rival, it simply does not exist.

[Dealer B: type 4250000, click "Whisper sealed quote".]
> Dealer B quotes too — four point two five — and Dealer A's column doesn't move either.

## 1:25 – 2:10 · Two ways to settle
[Buyer column now shows both quotes, each with an "Accept · direct OTC" button.]
> The buyer sees the two sealed asks — and can settle two ways. One: hit a single
> dealer directly, at its own ask. That's classic bilateral OTC, one click.
[Point at an "Accept · direct OTC" button — don't click it yet.]
> Or two — the competitive route: the cheapest ask wins, but is paid the *second*
> price. That's a Vickrey auction — dealers quote their honest price without shading,
> and the Award choice computes the clearing on-ledger.

[Click "Award — pay 2nd price (Vickrey)".]
> Either way it's one atomic transaction: cash to the winning dealer, the bond to the
> buyer — delivery-versus-payment. Both legs happen, or neither does.

[Balances update; point at the regulator line.]
> The winner is paid the second price, the losing bid's collateral is returned, and
> that losing quote is archived — never revealed to anyone. And the regulator sees
> exactly one thing: the executed trade at its clearing price. Nothing about the
> losing bid, nothing about the RFQ. Confidential pre-trade, auditable post-trade.

## 2:10 – 2:40 · Why Canton
[Talking head, or the "four chains before" slide.]
> Here's the part I'm proud of. I built this exact desk four times before this — on
> iExec with trusted hardware, on Stellar with two zero-knowledge circuits, on Sui
> with threshold encryption, on Ethereum with fully-homomorphic encryption. Every
> time, most of the code was machinery fighting the chain's transparency. On Canton,
> that machinery is gone. "Dealer B can't see Dealer A's quote" is one line —
> signatory and observer. The privacy I needed *is* the ledger's data model.

## 2:40 – 3:00 · Close — live on Devnet
[Switch to the second tab: the hosted desk at bisik-eight.vercel.app.]
> And this isn't a local sandbox. This is the same desk, running read-only over the
> shared Canton Devnet validator — live contracts, on-ledger right now.
[Point at the regulator line, then each dealer column, hold ~4s.]
> The regulator sees exactly one settled trade and nothing else. Each dealer sees only
> its own quote — neither receives the other's. That blindness isn't my UI; it's the
> Devnet ledger itself. Real Daml contracts, deployed and verifiable.
> Bisik: you whisper quotes, and the market hears nothing. Thanks.

---

**Shot-list checklist**
- [ ] RFQ creation visible
- [ ] Dealer A quote → Dealer B column demonstrably unchanged (hold ~3s)
- [ ] Dealer B quote submitted
- [ ] Both settlement modes named — point at an "Accept · direct OTC" button (don't
      click), then demo the Vickrey Award (competitive, 2nd price)
- [ ] Award → balances move, winner paid the 2nd price (4.25M)
- [ ] Regulator line shows only the settled trade
- [ ] The **hosted Devnet desk** (bisik-eight.vercel.app) on screen for the close —
      regulator column = only the settled trade, each dealer = only its own quote
      (this is the "real transactions on Devnet" proof Encode asks for)
- [ ] The "four chains before" line delivered to camera — this is the differentiator
