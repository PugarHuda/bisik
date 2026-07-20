# bisik-token-standard — a CIP-0056-shaped token standard, native on Daml

A self-contained implementation of the **Canton Network Token Standard's core shape**
(CIP-0056), separate from the Bisik desk so the live desk package (`b0058535…`) stays
frozen. Live on Canton Devnet (package `d969c045…`).

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

## Layout

Two packages, so the deployable DAR carries no test/script code (same split the desk uses):

```
token-standard/daml/TokenStandard.daml   the model  → bisik-token-0.1.0.dar (deploy this)
token-standard/test/daml/Test.daml       9 behavioural scripts (daml-script)
```

## Build, test, deploy

```bash
cd token-standard && daml build          # → .daml/dist/bisik-token-0.1.0.dar (no script code)
cd test && daml build && daml test       # 9 scripts: transfer, reject, expiry, atomic DvP,
                                         # foreign-leg rejection, unilateral-claim rejection,
                                         # lock freeze, amount boundaries, split/merge

# Deploy to Devnet + prove it live (from the repo root):
node scripts/devnet.mjs upload token-standard/.daml/dist/bisik-token-0.1.0.dar
LEDGER_ENV_FILE=scripts/.env.devnet npm run token:demo
# → two-step transfer instruction + atomic DvP allocation swap, verified on-ledger.
```

## Note on iterating a deployed package

Canton's smart-contract-upgrade check rejects re-uploading a changed package under the
same name+version (`KNOWN_PACKAGE_VERSION`), and rejects a version bump whose choice
signatures changed (`NOT_VALID_UPGRADE_PACKAGE`). Each breaking iteration therefore ships
under a fresh package **name** — a new upgrade lineage rather than an in-place upgrade.
