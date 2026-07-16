# Bisik — full detailed walkthrough · read-aloud script

A **long-form, feature-by-feature demo** you record in **your own voice** (Encode
disqualifies AI voice), then subtitle. This is the *detailed* cut — for the tight
3-minute Encode submission video use `DEMO-VO.md` instead.

**How to use this script**
- Read the **`>` quoted lines** word-for-word — that is the narration you subtitle.
- **`[ON SCREEN]`** lines are what to click/point at — *not* spoken.
- **`Note:`** lines are director context — say them in your own words if useful, or skip.
- Language: English (matches the deck and reaches international judges). Want a Bahasa
  Indonesia version? Ask and I'll translate the spoken lines.
- Pace ≈ 150 words/min. Read at a relaxed pace — this cut is meant to be thorough
  (roughly 8–11 minutes), not rushed.

**Before you record**
1. Terminal: `npm run demo` — wait for `http://localhost:8080`. This seeds *holdings
   only* (buyer holds 5,000,000 USDC; each dealer holds 1,000 TBOND30 bonds; the
   regulator sees nothing yet). You'll build the whole flow live on camera.
2. Browser tab A: open `http://localhost:8080`, click **Open the desk**. This is the
   interactive desk you drive.
3. Browser tab B: open `https://bisik-eight.vercel.app` and leave it on the desk —
   the read-only hosted desk over **real Canton Devnet**, for the "it's live" proof.
4. Optional second terminal for the MCP + autonomous-agent sections at the end.

---

## 1 · The problem (0:00 – 0:35)
> When an institution needs to trade a large block — say four million dollars of a
> thirty-year government bond — it cannot simply post that order on an open venue.
> The moment the size, or the competing bids, become visible, the market moves
> against them: other traders front-run the order and the price gets worse. That's
> called information leakage, and for block trades it's expensive. So this business
> still hides inside over-the-counter desks and private chat rooms — venues you have
> to *trust*, that leave no clean audit trail. Bisik brings that workflow on-chain,
> but with the confidentiality made real by the ledger itself, and the fairness
> enforced by code instead of promised by a middleman.

## 2 · The desk — three lenses on one ledger (0:35 – 1:25)
[ON SCREEN] The three-column desk. Sweep across the columns, then the top stat row, then the left sidebar.
> This is the Bisik desk. What you're looking at is **one Canton ledger, shown
> through three different parties' eyes at the same time**. On the left, the buyer —
> the institution that wants the bonds. On the right, two competing dealers, Dealer A
> and Dealer B, who will bid to sell them. This is the key idea, so I'll say it
> plainly: **each column shows only the contracts that party's own node actually
> receives.** It is not the interface hiding data from you — the ledger genuinely
> never sends one dealer the other dealer's information. We'll prove that in a moment.
>
> Across the top is a live dashboard: the current ledger offset — that's the ledger's
> own transaction counter, ticking as we act — the number of open requests, the
> number of sealed quotes in flight, and the number of settled trades. On the left is
> the desk's navigation, and a live connection indicator showing we're talking to the
> Canton JSON Ledger API right now.

Note: point at each stat tile as you name it. The offset number will visibly change later — that's proof it's a live ledger, not a mock-up.

## 3 · Opening a request for quotes (1:25 – 2:15)
[ON SCREEN] Buyer column → "Open an RFQ". Point at each field: Instrument (TBOND30), Quantity (1000), Pay in (USDC).
> Let's run a real trade. The buyer opens a **request for quotes** — an RFQ. Notice
> what's in it and what isn't. The instrument: a thirty-year treasury bond. The
> quantity: one thousand. The currency it'll pay in: US-dollar stablecoin. And
> critically — **there is no price on this request.** An RFQ is just an invitation to
> a hand-picked panel of dealers to come back with their best offer. It carries no
> bid, and the broad market never even sees it.
[ON SCREEN] Click "Send to dealer panel". The RFQ appears in both dealers' "Incoming RFQs".
> I send it to the panel. Behind that one click, the ledger created an RFQ contract
> whose only observers are the two invited dealers. Watch the dashboard — open
> requests just went to one, and the ledger offset advanced. And notice the request
> also appeared in *both* dealers' columns — because both were invited. Nobody else
> on the network can see it.

Note: the RFQ also carries an optional issuer binding and a deadline (covered in §9). Mention them here only if you want extra depth.

## 4 · The sealed quote — and the money shot (2:15 – 3:20)
[ON SCREEN] Dealer A column → type 4210000 into the ask field → click "Whisper sealed quote".
> Now Dealer A responds. It types its ask — four million, two hundred and ten
> thousand — and whispers a **sealed quote**. Two things just happened on the ledger,
> not one. First, the quote was created as a contract whose only signatories are
> Dealer A and the buyer — no observers at all. Second, and this matters for
> fairness: submitting the quote **locked Dealer A's bond into escrow.** The dealer
> can no longer double-sell that bond or quietly pull it back while its offer is
> standing. The collateral is committed.
[ON SCREEN] Point deliberately at Dealer B's column. Hold for a full three seconds. Nothing changes there.
> And here is the whole thesis in one shot. Watch Dealer B's column. Dealer A just
> submitted a live, binding quote… and on Dealer B's side, **nothing appeared.** Not
> a masked row, not a "hidden bid" placeholder — nothing, because Dealer B's node was
> never sent it. On a public blockchain, that bid would sit in the mempool for every
> competitor and bot to read before it's even confirmed. Here, for the rival, the
> quote simply does not exist. That's Canton's sub-transaction privacy: the ledger
> partitions who receives what, per transaction.
[ON SCREEN] Dealer B column → type 4250000 → click "Whisper sealed quote".
> Let Dealer B answer too — four million, two hundred and fifty thousand. Its bond
> locks into escrow as well. And look back at Dealer A: its column didn't move
> either. **Neither dealer can see the other's price.** They're quoting blind, exactly
> as they would on a real multi-dealer desk — which is what keeps the bidding honest.

## 5 · Proving the privacy on-ledger (3:20 – 4:05)
[ON SCREEN] Point at the buyer's "Quotes received" — two cards. Then Dealer A's "Your quotes" — one. Then Dealer B's — one. Then the stat tiles.
> Let's verify that instead of just asserting it. The **buyer** now sees both sealed
> asks side by side — it's the counterparty to every quote, so it's entitled to all
> of them. **Dealer A** sees exactly one quote: its own. **Dealer B** sees exactly
> one: its own. The dashboard agrees — two sealed quotes in flight, from the buyer's
> vantage; each dealer holds one. Same ledger, three different pictures, and the
> difference is enforced by the data model, not by a permission toggle we could turn
> off. This is the property that, on other chains, takes zero-knowledge proofs or
> homomorphic encryption to fake. On Canton it's just who is a signatory and who is
> an observer.

## 6 · Settlement, mode one — the competitive Vickrey auction (4:05 – 5:10)
[ON SCREEN] Buyer column. Point at the two quote cards; the cheapest is marked as the Vickrey winner. Point at the "Award — pay 2nd price (Vickrey)" button.
> Now the buyer settles — and Bisik gives it **two different ways** to do that. The
> first is a competitive auction. The buyer sees both sealed asks and clicks **Award**.
> The rule is a *reverse Vickrey* auction: the **cheapest ask wins**, but the winner is
> **paid the second-cheapest price**. That sounds odd, so here's why it's clever. When
> a dealer knows it'll be paid the runner-up's price rather than its own, it has no
> reason to shade its bid — its best move is to quote its true, honest price. The
> mechanism designs the gaming out. And the clearing price isn't computed in our web
> app where you'd have to trust it — it's computed **inside the Daml contract, on the
> ledger.**
[ON SCREEN] Click "Award — pay 2nd price (Vickrey)". Balances update; a settled trade appears in the regulator line; the "Settled trades" tile increments.
> One click, one atomic transaction. Dealer A wins because it was cheapest at four
> point two one, but it is paid the second price — four point two five. In the *same*
> transaction: the cash moves to Dealer A, the bond is delivered to the buyer, and the
> losing dealer's escrow is returned. The losing quote is archived — never revealed to
> the rival, or to anyone. Watch the balances move and the settled-trades counter tick
> up.

Note: to instead demonstrate **mode two** live, re-run `npm run demo` for a clean seed and, at this step, use the Accept button described in §7 rather than Award. Both are fully narrated so you can record either or both.

## 7 · Settlement, mode two — direct bilateral OTC (5:10 – 6:00)
[ON SCREEN] Point at the "Accept · direct OTC (pay ask …)" button sitting on each individual quote card.
> The second way to settle is **direct, bilateral OTC** — and you can see it on every
> quote card: an **Accept** button. Not every block trade is an auction. Sometimes the
> buyer just wants to hit one specific dealer at its firm quoted price and be done.
> That's what Accept does: it settles **that one dealer** at **its own ask** — no
> auction, no second-price rule. If I click Accept on Dealer A's four-point-two-one
> quote, the trade settles at four-point-two-one exactly, bilaterally.
> The important part: it's the **same rails**. Same sealed privacy — the other dealer
> still never saw this quote. Same atomic delivery-versus-payment. Same escrow.
> The buyer simply chooses the mechanism that fits the trade: **competitive Vickrey
> when it wants price discovery, direct OTC when it wants to hit a name.** Both are on
> one desk, and both are just choices on the same underlying contracts — we didn't
> need a second protocol.
[ON SCREEN] Point at the "Partial fill" field and the "Fill partial (prorated)" button under a quote.
> And it doesn't have to be all-or-nothing. Right below Accept is a **partial fill**.
> The buyer can take, say, four hundred of a thousand-bond quote. The contract prorates
> the ask exactly — four hundred out of a thousand of a four-point-two-five-million ask
> is one-point-seven million — hands over just those four hundred bonds, and returns the
> unfilled six hundred to the dealer, all in one atomic transaction. Real desks fill in
> size; so does this one.

Note: on the hosted read-only Devnet tab, the Accept and partial-fill buttons are visible but no-op — writes are blocked server-side there; they only settle on your local interactive desk.

## 8 · Atomicity and escrow safety (6:00 – 6:45)
[ON SCREEN] Point at the buyer's holdings (bond now present) and note the dealer's cash. Then the regulator line.
> Let me be precise about two guarantees, because they're what make this
> institution-grade rather than a toy. First, **atomic delivery-versus-payment.**
> Settlement is a single ledger transaction that moves *both* legs — cash one way, the
> bond the other. Either both happen or neither does. There is no window where the
> buyer has paid but not received, or a dealer has delivered but not been paid. If the
> buyer's cash is more than the price, the contract even splits it exactly and returns
> the change — all inside the one transaction.
> Second, **escrow.** From the instant a dealer quotes, its bond is locked. It can't be
> sold twice, and it can't be yanked back to sabotage the buyer's award. Releasing it
> needs *both* the dealer's and the buyer's authority — which only ever comes together
> inside a legitimate settlement, a rejection, or the dealer's own explicit withdrawal.
> Nobody can pull collateral out from under a live auction.

## 9 · The guardrails you don't see (6:45 – 7:30)
[ON SCREEN] Slowly re-point at the RFQ form and a quote card while you list these.
> Underneath the clicks there's a layer of contract rules that quietly refuse to let a
> bad trade happen. A quote is **bound to its own RFQ** — a dealer's offer can only ever
> settle the exact request it answered, never cross-settle into a different one that
> happens to share the same instrument and size. Quotes and cash can be **bound to
> specific issuers** — so the buyer can insist the bond comes from the real issuer and
> the payment is in the real stablecoin, not a look-alike. RFQs can be **time-boxed** —
> once the deadline passes, late quotes are rejected by the ledger. Amounts must be
> **positive**, and the price field only accepts a clean decimal — no scientific
> notation, no malformed numbers reaching the ledger. None of this is front-end
> decoration; every one of these is checked inside the Daml contract, so it holds no
> matter what client is talking to the ledger.

## 10 · The regulator — confidential pre-trade, auditable post-trade (7:30 – 8:10)
[ON SCREEN] Sidebar → click "Audit trail" to scroll to the regulator line. Point at it.
> Now the other half of the story. Regulators need oversight — but oversight doesn't
> have to mean surveillance of every quote. Look at the regulator's view. Before any
> trade settled, the regulator saw **nothing** — no RFQ, no sealed bids, zero pre-trade
> visibility. After settlement, it sees **exactly one thing**: the executed trade — the
> instrument, the quantity, and the clearing price. Nothing about the losing bid,
> nothing about who else was invited, nothing about the RFQ itself. That's the balance
> institutions actually need: **confidential before the trade, fully auditable after
> it** — and again, it's a single line in the contract that makes the regulator an
> observer of the trade report and nothing else.

## 11 · It's live on real Canton Devnet (8:10 – 8:55)
[ON SCREEN] Switch to browser tab B — the hosted desk at bisik-eight.vercel.app.
> Everything so far ran on a local sandbox so I could drive it. But this is not a
> local trick. Switch to the hosted desk — this is the **same application running,
> read-only, over the shared Canton Devnet validator**, with live contracts on-ledger
> right now.
[ON SCREEN] Point at the regulator line (one settled trade), then each dealer column (one quote each), then the stat tiles.
> On Devnet, the regulator sees one settled trade and nothing else. Each dealer sees
> only its own sealed quote — neither receives the other's. The dashboard shows the
> live ledger offset from the real validator. This desk is deliberately read-only: it
> serves reads with the credential kept on the server and blocks every write, so a
> public link can never touch the shared validator. The privacy you're seeing here
> isn't my interface choosing what to show — it's what the Devnet ledger actually sent
> each party.

## 12 · Agent-native — an AI can verify the privacy itself (8:55 – 9:40)
[ON SCREEN] Optional: a terminal. Run `npm run agent:demo`. Let the output print.
> One more dimension, because this is where it gets forward-looking. Bisik exposes the
> desk as tools an AI agent can use — over the Model Context Protocol — and it ships an
> **autonomous market-maker**. Watch: a software agent, acting as a dealer, detects an
> RFQ it was invited to and **submits its own sealed quote automatically**, priced by
> its own rule — a reference price plus a markup. And because it's a party on Canton
> like any other, it only ever receives its own invitations. It is quoting **blind to
> its rivals**, exactly like a human dealer. On top of that, the agent tools let an AI
> *audit Canton's privacy for itself* — it can ask the ledger, "as Dealer A, what do I
> see?" and get back only Dealer A's own contracts. The privacy model isn't just
> claimed to a human; it's verifiable by a machine.

Note: the MCP server itself is `cd mcp && npm start` (it speaks over stdio to an AI client). The `agent:demo` above is the on-screen, human-readable version of the same idea.

## 12b · Depth beyond the three columns (optional)
[ON SCREEN] Talking head, or the passing `daml test` output / the model code.
> A few capabilities live in the contracts even though the demo desk keeps to one
> instrument for clarity. The model settles **multi-instrument baskets** — a buyer
> requests several legs as one package, a dealer prices the whole basket, and every leg
> plus the cash settles in a single atomic transaction, still sealed. The asset and cash
> legs implement a **CIP-0056-aligned token interface**, so a standard wallet or
> settlement engine can move them without knowing our template. A dealer may hold only
> **one quote per auction**, enforced on-ledger. And the desk refreshes the instant the
> ledger moves, over a **push stream** rather than a timer. Fifteen behavioural tests
> cover all of it — including the privacy assertions themselves.

## 13 · Why Canton — the differentiator (9:40 – 10:25)
[ON SCREEN] Talking head, or a slide listing the four prior chains.
> Here's the part I'm most proud of, and it's why Bisik is on Canton specifically. I
> have built this exact product **four times before**, on four different chains — on
> iExec using trusted hardware enclaves, on Stellar with two hand-written
> zero-knowledge circuits, on Sui with threshold encryption and off-chain storage, and
> on Ethereum with fully-homomorphic encryption. Every single time, the *majority* of
> the code wasn't the trading logic — it was cryptographic machinery fighting the
> chain's default transparency, just to hide a bid. On Canton, that machinery is
> **gone.** "Dealer B cannot see Dealer A's quote" is one line — a signatory and an
> observer declaration. The privacy I spent four projects engineering **is simply the
> ledger's data model.** This is the argument for Canton, made by someone who tried the
> alternatives and counted the code.

## 14 · Close (10:25 – 10:45)
[ON SCREEN] The hosted Devnet desk, or the repo.
> So that's Bisik: a confidential multi-dealer RFQ desk, with sealed quotes, two
> settlement modes — competitive Vickrey and direct OTC — atomic delivery-versus-
> payment, escrow-backed guarantees, a regulator's clean post-trade audit, an
> autonomous market-making agent, and it's deployed and verifiable on Canton Devnet.
> Bisik — you whisper quotes, and the market hears nothing. Thank you.

---

## Feature reference (for subtitling / captions)
One line per feature — handy when you're writing the on-screen text.

| Feature | What it is | Where it shows |
|---|---|---|
| Three-lens desk | One ledger rendered as buyer + 2 dealers + regulator simultaneously | Whole desk |
| Live dashboard tiles | Ledger offset, open RFQs, sealed quotes, settled trades | Top row |
| Sidebar in-app nav | The desk / Create RFQ / Settlement / Audit trail (scroll + highlight) | Left rail |
| RFQ | Priceless request to a chosen dealer panel; market can't see it | Buyer → Open an RFQ |
| Sealed quote | Dealer's ask; signatories dealer + buyer, no observers | Dealer → Whisper sealed quote |
| Sub-transaction privacy | Rival dealer's node never receives the quote (the "money shot") | Dealer B stays blank |
| Escrow lock | Dealer's bond locked on quote; can't double-sell or pull back | On quote submit |
| Reverse Vickrey Award | Cheapest wins, paid the 2nd price; clearing computed on-ledger | Buyer → Award button |
| Direct OTC Accept | Hit one dealer at its own ask; bilateral, same rails | Accept button per quote |
| Partial fill | Take part of a lot at the prorated ask; remainder returns to dealer | Fill partial button per quote |
| One quote per dealer | A dealer can't stuff the auction; enforced on-ledger in Award | Contract rule |
| Atomic DvP | Cash + bond move in one transaction; both legs or neither | On settle |
| Cash split + change | Exact price taken, remainder returned, in the same transaction | On settle |
| RFQ-bound quotes | A quote can only settle its own RFQ | Contract rule |
| Issuer binding | Bond/cash must come from the expected issuer | RFQ fields |
| Time-boxed RFQ | Late quotes rejected after the deadline | Contract rule |
| Input validation | Positive amounts only; clean decimal price only | Forms |
| Regulator observer | Sees only settled trades — nothing pre-trade | Footer / Audit trail |
| Live on Devnet | Same app, read-only, over the shared Canton Devnet validator | bisik-eight.vercel.app |
| Read-only proxy | Serves reads with server-side credential; blocks all writes | Hosted desk |
| Multi-instrument basket | Several legs as one package; single price, atomic multi-leg DvP | On-ledger (BasketRFQ) |
| CIP-0056 Token interface | Legs implement a standard Token so generic tooling can move them | On-ledger (Token) |
| SSE push stream | Desk refreshes the instant the ledger moves, not on a timer | Local server `/api/stream` |
| MCP server | Desk as read-only tools for AI agents (stdio) | `cd mcp && npm start` |
| Autonomous agent | Market-maker auto-quotes RFQs it's invited to, blind to rivals | `npm run agent:demo` |
| Canton thesis | Privacy is the data model, not bolted-on cryptography | The pitch |
