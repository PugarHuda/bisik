# bisik-token-standard — a CIP-0056-shaped token standard, native on Daml

A self-contained implementation of the **Canton Network Token Standard's core shape**
(CIP-0056), separate from the Bisik desk so the live desk package (`b0058535…`) stays
frozen. Live on Canton Devnet (package `05e4ebb9…`).

## What it models

| Piece | Role |
|---|---|
| `Holding` (interface) + `Token` | A standard, viewable fungible position in one instrument, with an optional `Lock` so tooling can see reserved state. Split / merge included. |
| `TransferInstruction` | A **two-step** transfer: the sender proposes, the receiver `AcceptTransfer` / `RejectTransfer` (or the sender `WithdrawTransfer`, or it expires at the deadline). |
| `Allocation` | Reserve part of a holding for a named settlement leg, so multiple legs can execute together. |
| `DvpSettlement` | **Atomic delivery-versus-payment**: two allocations execute in one transaction — both legs or neither. |
| `Metadata` | The string→string map the standard threads through operations. |

This is the standard's **on-ledger shape**, native (no external DARs). Full
cross-package registry interop — external-wallet `TransferFactory` / `AllocationFactory`
discovery via the Splice token-standard DARs — is the further step.

## Build, test, deploy

```bash
daml build                                   # → .daml/dist/bisik-token-standard-v3-0.1.0.dar
daml test                                    # 4 scripts: transfer, reject, atomic DvP, split/merge

# Deploy to Devnet + prove it live (from the repo root):
node scripts/devnet.mjs upload token-standard/.daml/dist/bisik-token-standard-v3-0.1.0.dar
LEDGER_ENV_FILE=scripts/.env.devnet npm run token:demo
# → two-step transfer instruction + atomic DvP allocation swap, verified on-ledger.
```
