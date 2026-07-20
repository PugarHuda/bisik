# Bisik MCP server — the desk as AI-native tools

A [Model Context Protocol](https://modelcontextprotocol.io) server that exposes the
live Bisik desk to AI agents. This is the **agentic-commerce** angle: an agent can
read the post-trade audit trail, verify Canton's privacy model for itself (query as
any party and watch it receive only its own data), *and* **initiate a real commercial
action** — post an RFQ on-ledger.

Reads are open. The one write tool (`post_rfq`) submits with the **operator's own
local credentials** — it reuses the same gitignored `scripts/.env.devnet` (token) and
`scripts/devnet.parties.json` (party ids) the deployer uses. The public hosted proxy
stays read-only; writing is a deliberate, locally-run capability, never exposed to the
internet.

## Tools

| Tool | What it returns |
|---|---|
| `explain_desk` | What Bisik is and how the privacy model works (no ledger call). |
| `party_view` | The on-ledger contract counts a given party actually receives — proves sub-transaction privacy live (a dealer sees only its own quote; the regulator sees no pre-trade flow). |
| `list_settlements` | The regulator's post-trade audit trail: settled trades and their Vickrey clearing price. |
| `market_snapshot` | Open RFQs, sealed quotes in flight, settled trades. |
| `best_execution` | For each settled trade, compares the executed price against the sealed asks disclosed to the regulator — provable best execution, no public order book. |
| `post_rfq` *(write)* | Posts a confidential RFQ on-ledger as the buyer, inviting the dealer panel. A real commercial action; appears live on the desk within seconds. Uses the operator's local credentials. |

## Run

```bash
cd mcp && npm install
# Devnet (reads ../scripts/.env.devnet + ../scripts/devnet.parties.json):
npm start
# Local sandbox instead:
LEDGER_JSON_URL=http://localhost:7575 npm start
```

## Use from an MCP client (Claude Desktop, Cursor, …)

Drop `.mcp.json` (repo root) into your client config, or add:

```json
{ "mcpServers": { "bisik": { "command": "node", "args": ["mcp/server.mjs"], "cwd": "/abs/path/to/bisik" } } }
```

Then ask the agent: *"explain the Bisik desk"*, *"what does dealerA see on-ledger?"*,
*"list the settled trades"*, *"attest best execution"*, or — to act — *"post an RFQ for
TBOND30 ×1000"* and watch it land on the desk, sealed to each dealer.

## Why this is interesting

An agent verifying **`party_view dealerA` shows only Dealer A's own quote** while
**`party_view regulator` shows nothing pre-trade** is the privacy guarantee,
demonstrated to a machine — not asserted in a slide. That's Private DeFi meeting
agentic commerce on one confidential ledger.
