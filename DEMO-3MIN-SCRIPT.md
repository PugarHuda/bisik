# Bisik — live demo narration (read this in your own voice)

Recorded video: `media/bisik-demo-3min.webm` · subtitles: `media/bisik-demo-3min.srt`
Total runtime: **3:04**. Pace assumed: 150 words/min.
Timecodes below are video-relative (they already include the 1680ms lead-in).

Encode requires a **real human voice** — record yourself reading the lines below,
timed against the video. The timecodes are measured from the actual recording, so
if you keep pace the words land on the right frames.

---

### 0:01 – 0:13 · Landing · the hook

> When an institution moves a large block of bonds, it cannot simply post it — the moment the order and the competing bids are visible, the market front-runs it.

### 0:13 – 0:21 · Landing · what Bisik is

> Bisik is a confidential over-the-counter desk built natively on Canton.
> You whisper quotes, and the market hears nothing.

### 0:21 – 0:33 · Landing · the lineage

> We have built this same product four times before, on four different chains.
> Every time, most of the work was cryptography fighting the ledger. On Canton, that machinery disappears.

### 0:33 – 0:39 · Landing · into the desk

> Let me show you the desk itself, running against a live Canton ledger.

### 0:39 – 0:51 · Desk · three views of one ledger

> These three columns are one ledger seen by three parties: a buyer and two competing dealers.
> Each column shows only what that party’s own node actually received.

### 0:51 – 1:02 · Desk · the request for quote

> The buyer opens a request for quote: a thirty-year treasury, one thousand units, paid in tokenised dollars.
> The market never sees this. Only the invited dealers do.

### 1:02 – 1:13 · Desk · dealer A whispers a price

> Dealer A now sees the request, and answers with a sealed quote — four million, two hundred and ten thousand.
> Watch what happens on the right.

### 1:13 – 1:30 · Desk · THE MONEY SHOT

> Dealer B's column is empty. Not a masked row. Not a hidden-bid placeholder. Nothing at all.
> Dealer A's quote was never transmitted to Dealer B's node. That is not the interface hiding it — it is the ledger never sending it.

### 1:30 – 1:42 · Desk · dealer B competes, blind

> Dealer B quotes too — four million, two hundred and fifty thousand — completely blind to its rival.
> The buyer now holds both sealed quotes. Neither dealer can see the other.

### 1:42 – 1:51 · Desk · selective disclosure

> Either side can reveal one sealed quote to a regulator on demand — never to a rival, never in public.

### 1:51 – 2:05 · Desk · the Vickrey award

> Now the buyer awards. The cheapest dealer wins — but is paid the second price, four million two hundred and fifty thousand.
> Cash and bond move in a single atomic transaction: both legs, or neither.

### 2:05 – 2:17 · Verify privacy

> You don’t have to trust the privacy. This view queries what each node actually holds:
> each dealer sees only its own quote, and the regulator sees nothing before settlement.

### 2:17 – 2:32 · Best execution

> This is what institutions actually need. A public exchange proves best execution against a visible order book.
> Bisik has no order book — and still proves it, from the sealed asks disclosed to the regulator.

### 2:32 – 2:46 · Deck · agentic settlement

> The same desk runs autonomously: two market-maker agents quote blind to each other, a buyer agent awards, and a real trade settles on Devnet at the second price — with no human in the pricing loop.

### 2:46 – 2:56 · Deck · live on Devnet

> None of this is a mock-up. Forty-one settled trades, five atomic baskets and sixteen best-execution attestations are live on Canton Devnet right now.

### 2:56 – 3:04 · Close

> Bisik — the confidential OTC desk that finally didn’t need a cryptography stack, because Canton already is one.
