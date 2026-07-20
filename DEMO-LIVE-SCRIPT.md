# Bisik — live demo narration (read this in your own voice)

Recorded video: `media/bisik-live-demo.webm` · subtitles: `media/bisik-live-demo.srt`
Total runtime: **4:35**. Pace assumed: 150 words/min.
Timecodes below are video-relative (they already include the 1720ms lead-in).

Encode requires a **real human voice** — record yourself reading the lines below,
timed against the video. The timecodes are measured from the actual recording, so
if you keep pace the words land on the right frames.

---

### 0:01 – 0:14 · Landing · the hook

> When an institution wants to move a large block of bonds, it cannot simply post it.
> The moment the order and the competing bids become visible, the market front-runs it.

### 0:14 – 0:21 · Landing · what Bisik is

> Bisik is a confidential over-the-counter desk built natively on Canton.
> You whisper quotes, and the market hears nothing.

### 0:21 – 0:35 · Landing · how it works

> A buyer asks a chosen panel of dealers for a price. Each dealer answers with a sealed quote.
> The cheapest ask wins, but it is paid the second-cheapest price, so dealers can quote honestly.

### 0:35 – 0:48 · Landing · the model

> The entire privacy layer is the data model itself. There are no circuits and no encryption stack.
> A quote is signed by the dealer and the buyer, and by nobody else.

### 0:48 – 1:00 · Landing · the lineage

> We have built this same product four times before, on four different chains.
> Every time, most of the work was cryptography fighting the ledger. On Canton, that machinery disappears.

### 1:00 – 1:07 · Landing · into the desk

> Let me show you the desk itself, running against a live Canton ledger.

### 1:07 – 1:21 · Desk · three views of one ledger

> These three columns are not three apps. They are one ledger, seen by three different parties:
> the buyer, and two competing dealers. Each column shows only what that party's own node actually received.

### 1:21 – 1:32 · Desk · the request for quote

> The buyer opens a request for quote: a thirty-year treasury, one thousand units, paid in tokenised dollars.
> The market never sees this. Only the invited dealers do.

### 1:32 – 1:43 · Desk · dealer A whispers a price

> Dealer A now sees the request, and answers with a sealed quote — four million, two hundred and ten thousand.
> Watch what happens on the right.

### 1:43 – 2:00 · Desk · THE MONEY SHOT

> Dealer B's column is empty. Not a masked row. Not a hidden-bid placeholder. Nothing at all.
> Dealer A's quote was never transmitted to Dealer B's node. That is not the interface hiding it — it is the ledger never sending it.

### 2:00 – 2:12 · Desk · dealer B competes, blind

> Dealer B quotes too — four million, two hundred and fifty thousand — completely blind to its rival.
> The buyer now holds both sealed quotes. Neither dealer can see the other.

### 2:12 – 2:26 · Desk · selective disclosure

> Either side can reveal one sealed quote to a regulator on demand — without ever showing it to a rival, or to the public.
> That is what makes the next part possible.

### 2:26 – 2:40 · Desk · the Vickrey award

> Now the buyer awards. The cheapest dealer wins — but is paid the second price, four million two hundred and fifty thousand.
> Cash and bond move in a single atomic transaction: both legs, or neither.

### 2:40 – 2:55 · Verify privacy

> You do not have to take the privacy on trust. This view queries what each party's node actually holds.
> Each dealer sees only its own quote. The regulator sees nothing at all before the trade settles.

### 2:55 – 3:06 · Verify privacy · the contrast

> And here is what a transparent chain would have leaked at that exact moment — every live quote, every open order.
> On Canton, the number is zero.

### 3:06 – 3:29 · Best execution

> This is the part institutions actually need. A public exchange proves best execution against a visible order book.
> Bisik has no order book — and still proves it. From the sealed asks disclosed to the regulator, every settled trade is checked: the winner quoted the lowest price, and the buyer paid no worse than any competitor.

### 3:29 – 3:37 · Audit trail

> The regulator's record shows executed trades, and only executed trades. Confidential before the trade, auditable after it.

### 3:37 – 3:46 · Portfolio

> And each party sees its own positions — the buyer now holds the bond, the winning dealer holds the cash.

### 3:46 – 3:49 · Deck · why Canton

> To close, the argument in one slide.

### 3:49 – 4:00 · Deck · the lineage table

> Four previous builds, four cryptography stacks: trusted hardware, zero-knowledge circuits, threshold encryption, fully homomorphic encryption.
> On Canton: none of it. Sub-transaction privacy is simply the ledger model.

### 4:00 – 4:15 · Deck · agentic settlement

> The same desk runs autonomously: two market-maker agents quote blind to each other, a buyer agent awards, and a real trade settles on Devnet at the second price — with no human in the pricing loop.

### 4:15 – 4:25 · Deck · live on Devnet

> None of this is a mock-up. Forty-one settled trades, five atomic baskets and sixteen best-execution attestations are live on Canton Devnet right now.

### 4:25 – 4:35 · Close

> Bisik: the confidential OTC desk that finally did not need a cryptography stack — because Canton already is one.
> You whisper quotes. The market hears nothing.
