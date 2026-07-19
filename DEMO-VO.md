# Bisik — 3-minute demo · read-aloud script

Word-for-word narration to **record in your own voice** (Encode disqualifies AI
voice). Read the **plain lines**; the `[bracketed]` lines are what to do on screen,
not spoken. Pace is ~150 words/min → the whole thing lands right around 3:00.

**Before you hit record:** `npm run demo`, wait for `http://localhost:8080`, open it,
click **Open the desk** — the interactive tab you drive the money shot in. Also open a
**second tab on the live site https://bisik-eight.vercel.app/app** and leave it on the
desk — that tab is read-only over the real Canton Devnet, and you switch to it for the
climax. Its current live state is rich: **15+ settled trades** the regulator can audit
(US Treasuries, Gilts, Bunds, JGB, OAT, corporates, EM), several **open RFQs**, and —
the climax — **10 provable best-execution attestations** across the Vickrey, direct-OTC
and partial-fill rails. The narration stays instrument-agnostic so it matches whatever
is on-ledger at record time.

---

## 0:00 – 0:20 · The problem
> When an institution wants to trade a large block — say a couple of million dollars of
> a government bond — it can't just post it. The moment the order, or the competing
> bids, become visible, the market front-runs it. So block trading hides in OTC desks
> and chat rooms you have to trust. Bisik is an on-chain OTC desk where the bids are
> genuinely sealed — and the fairness is provable, not promised.

## 0:20 – 0:38 · What you're looking at
[Show the desk — the three columns.]
> One Canton ledger, three views. The buyer on the left, two competing dealers on the
> right. Each column is what that party's own node actually receives. This isn't the UI
> hiding anything — it's the ledger.

## 0:38 – 1:20 · The money shot
[Buyer: click "Send to dealer panel".]
> The buyer opens a request for a block of bonds. There's no price on it — just an
> invitation to a chosen panel. The market never sees this RFQ.

[Dealer A: type 4210000, click "Whisper sealed quote".]
> Dealer A answers with a sealed quote — four point two one million.

[Point at Dealer B's column. Hold for three seconds.]
> Now watch Dealer B. Dealer A just quoted… and nothing appeared. Dealer B's node never
> received it. On a public chain that bid would sit in the mempool for anyone to see.
> Here, for the rival, it simply does not exist.

[Dealer B: type 4250000, click "Whisper sealed quote".]
> Dealer B quotes too — four point two five — and Dealer A's column doesn't move either.

## 1:20 – 1:52 · Settle — atomic, Vickrey, confidential
[Click "Award — pay 2nd price (Vickrey)".]
> The buyer awards. The cheapest ask wins, but is paid the *second* price — a Vickrey
> auction, so dealers quote their honest price without shading. It settles in one atomic
> transaction: cash to the winning dealer, the bond to the buyer — delivery versus
> payment, both legs or neither.

[Balances update; point at the regulator line.]
> The losing bid's collateral is returned, and that quote is archived — never revealed.
> The regulator sees exactly one thing: the executed trade. Nothing about the losing
> bid, nothing about the RFQ. Confidential pre-trade, auditable post-trade.

## 1:52 – 2:28 · The payoff — provable best execution, live on Devnet
[Switch to the second tab: the hosted desk at bisik-eight.vercel.app. Click "Best execution" in the sidebar.]
> And here's the institutional payoff — running read-only over the live Canton Devnet
> right now. A public exchange audits best execution against a visible order book. Bisik
> has no public book — the pre-trade stays confidential — yet the regulator still proves
> it.

[Point at a green "best execution attested" card.]
> For each trade, the counterparties selectively disclosed their sealed asks to the
> regulator — and only the regulator. It confirms the winner quoted the lowest ask and
> the buyer paid no worse than any competitor. Every one of these is a real settlement
> on Devnet — across the competitive auction, direct bilateral OTC, and partial fills.
> Confidential pre-trade, provable post-trade — with no public order book anywhere.

## 2:28 – 2:52 · Why Canton
[Talking head, or the "four chains before" slide / the Verify-privacy contrast panel.]
> I built this exact desk four times before this — on iExec with trusted hardware, on
> Stellar with two zero-knowledge circuits, on Sui with threshold encryption, on
> Ethereum with fully-homomorphic encryption. Every time, most of the code was machinery
> fighting the chain's transparency. On Canton that machinery is gone. "Dealer B can't
> see Dealer A's quote" is one line — signatory and observer. The privacy I needed *is*
> the ledger's data model.

## 2:52 – 3:00 · Close
[Back to the desk, or hold on the green best-execution cards.]
> Real Daml contracts, deployed and verifiable on Devnet. Sealed bids, atomic
> settlement, and best execution you can prove — with nothing leaked to the market.
> Bisik: you whisper quotes, and the market hears nothing. Thanks.

---

**Shot-list checklist**
- [ ] RFQ creation visible
- [ ] Dealer A quote → Dealer B column demonstrably unchanged (hold ~3s) — the money shot
- [ ] Dealer B quote submitted
- [ ] Vickrey Award → balances move, winner paid the 2nd price, regulator line shows only the settled trade
- [ ] **Switch to the hosted Devnet desk** (bisik-eight.vercel.app/app) → **Best execution** view — green "attested" cards on screen (this is the marquee + the "real transactions on Devnet" proof Encode asks for)
- [ ] Name all three rails while on the best-execution view: Vickrey, direct OTC, partial fill
- [ ] The "four chains before" line delivered to camera — the differentiator
- [ ] Optional: flash the **Verify privacy** view's "what a transparent chain would leak" contrast panel behind the Why-Canton line

**Optional 30-second extension (if you record a longer cut):** on the interactive desk,
before awarding, click **⚖ Disclose to regulator** on one sealed quote, then open the
**Audit trail** — show that the buyer (or a dealer) can reveal one quote to a regulator
on demand, and a rival still never sees it. That's the selective-disclosure primitive
the best-execution proof is built on.
