# Wallet 2ZzxuHxvPQtPU48Tffs8LD8sy17rgjBRQviRVxQ54fR6 — Full Activity Breakdown

_Analysis date: 2025-10-13_  
_Data source: Helius enhanced transaction history (12 000 tx, 2024-11-16 → 2025-10-13)_

---

## 1. Executive Snapshot
- **Role**: Settlement wallet for a reward-harvesting & liquidity-maintenance bot focused on Marinade (MNDE) yield loops. 
- **Core pattern**: Every profitable cycle is a two-leg combo — (1) `TOKEN_MINT` transaction run by a custom program cluster that pays the wallet in USDC for seeding MNDE, immediately followed by (2) a Jupiter swap that restores the MNDE stack while releasing realised spread.
- **Capital footprint**: Operates with ~30 USDC + 30 MNDE in the hot wallet; the heavy lifting (LP positions, vault balances) sits in helper accounts controlled by the same operator.
- **Profit location**: Wallet itself retains ~+285 USDC and +142 MNDE over the measured period (~$300); bulk of value is siphoned to side accounts `2bhk…`, `ARu4n…`, `2YM8Lr…` during mint legs, implying actual profits accrue off-wallet.
- **Tooling**: No Jito bundles or advanced MEV shielding — everything rides mainnet mempool with tiny priority fees. Flash-loan legs use Kamino’s lending program for zero-capital repositioning.

---

## 2. Data Overview
- **Transactions pulled**: 12 000 (max fetch cap), containing 6 583 `SWAP`, 5 303 `TOKEN_MINT`, 96 `FLASH_REPAY_RESERVE_LIQUIDITY`, plus minor `TRANSFER`s.
- **Fee spend**: 1.19 SOL total (≈$200 over 11 months) → per tx average fee ~0.000099 SOL.
- **Sources**: Jupiter (3 957 swaps), Raydium CLMM (`CAMMC…`/`LBUZ…`), Orca Whirlpool (`whirLb…`), a bespoke program pair `6LtLpn…` + `proVF4…`, and Kamino (`KLend…`).
- **Observation window**: 2024-11-16 to 2025-10-13; activity is steady, peaking during MNDE incentive epochs.

Key artefacts in `analysis/`:
- `*-enhanced.json` — raw enhanced dataset
- `*-enhanced-summary.json` — type/source histograms, program frequencies
- `*-enhanced-swaps.json` — 6 583 parsed swap legs
- `*-enhanced-counterparties.json` — 116 k program/counterparty touches

---

## 3. Signature Archetypes

### 3.1 Reward-Mint Combo (`TOKEN_MINT` → Jupiter `SWAP`)
Representative pair:
1. **Mint leg** — `2JSJ46xLLkjzN1CmMkVyi5hQXe3LShkbdCcsWzdMAmWVhCo7Pw9pew1T6G4B5SQZW44KNxf24qnJYH6GyPvudf1t`
   - Invokes `6LtLpn…` (custom orchestrator) and `proVF4…` (Anchor-based helper) which bundle calls to Orca Whirlpool + SPL token program.
   - Wallet sends **28.879 MNDE** from ATA `AfF3SJF…` to helper account `GwknKVv…`.
   - Wallet receives **3.4969 USDC** into ATA `FT4GQqs…`.
   - Side accounts `2bhk…`, `ARu4n…`, `ByXm…`, `2YM8Lr…` collect the bulk of MNDE (37.485 MNDE) and micro-fee tokens (`12Uj74…`), indicating these addresses hold the yield positions.

2. **Swap leg** — `3RBGjMnspsmyWsmmsmRMXvXXz5zZ4zM8ntjpgfWkzw3z25ujzKSPRBL7esPBp4dSQKpGtMgKSG8ey1hPUXpgU5o5`
   - Jupiter routes ~0.752 USDC into MNDE (source `JUPITER` with inner WHIRL/CLMM hops).
   - Wallet sends **6.1815 MNDE** to route, receives **0.752 USDC** back.
   - Net effect: wallet roughly breaks even on MNDE quantity but accumulates the USDC premium paid out during the mint leg.

> Pattern repeats thousands of times: `TOKEN_MINT` sells MNDE at a premium (wallet gets USDC), then Jupiter swap buys back MNDE cheaply. Spread realizes as profit.

### 3.2 Kamino Flash Rebalance (`FLASH_REPAY_RESERVE_LIQUIDITY`)
Signature `43G9GDbNa3odoKw3oovGRnG3qSBqRWTUFUoMUYf4r38SS1xpHf5kvUT7R1aHGLP4VaefdiEtuDEtcq1CQJ4XtsLy` (see full decode in summary):
- Loan: Borrow ~7.66 USDC from Kamino reserve (accounts `y9pM263…`, `Bgq7tr…`).
- Operations: Funnel MNDE, mSOL, and USDC through Raydium CLMM (`CAMMC…`, `LBUZ…`) and Vault manager addresses to harvest fees / re-range liquidity positions.
- Repay: Return USDC principal + fees, pocket ~+1.99 USDC in wallet and push MNDE/mSOL adjustments to helper accounts.
- Frequency: 96 occurrences, usually after major price moves.

### 3.3 Noise / Maintenance
- Sparse system-program `TRANSFER`s distributing 1 lamport “keep alive” payments from account `2rugftp…` to a fan-out of addresses (likely rent keepers for strategy ATAs).
- Occasional `TOKEN_MINT` entries where wallet is only intermediary (receives and sends identical amounts) — these sync the helper accounts without net effect.

---

## 4. Net Cashflows & Inventory Drift
Aggregated over 12 000 tx (wallet perspective):

| Mint | In | Out | Net |
|------|----------------|----------------|----------------|
| **USDC (EPjF…)** | 24 640.2899 | 22 291.0976 | **+2 349.1923** |
| **MNDE (MNDE…)** | 203 702.1355 | 215 356.3959 | **−11 654.2603** |
| **Swaps only — USDC** | 29 475.0617 | 31 667.8290 | **−2 192.7674** |
| **Swaps only — MNDE** | 284 933.4030 | 272 596.3826 | **+12 337.0204** |
| **Kamino flash loops — USDC** | 671.5488 | 542.7892 | **+128.7596** |
| **Kamino flash loops — MNDE** | 4 845.4802 | 5 385.3603 | **−539.8801** |

Interpretation: Mint legs drain MNDE while paying USDC; Jupiter swaps restore MNDE at cheaper cost (net +12.3 k MNDE inside swaps). When you sum both layers the wallet ends up **+285.184 USDC** and **+142.880 MNDE**. The missing mass (tens of thousands MNDE) accrued in helper accounts points to yield farming positions accruing fees outside this wallet.

---

## 5. Program & Counterparty Map
Top programs invoked:
- `Tokenkeg…` — 121 k hits (all SPL transfers)
- `JUP6Lkb…` (Jupiter v6) — 17 667 hits
- `whirLbMi…` (Orca Whirlpool) — 5 100 hits
- `CAMMCzo…` / `LBUZKhR…` (Raydium CLMM) — ~3 760 hits combined
- `6LtLpnUF…` + `proVF4pM…` — ~230 combined per day (bespoke orchestrators)
- `KLend2g3…` — 97 hits (Kamino lending)

Key counterparties (frequency):
- `2bhkQ6…`, `ARu4n5…`, `2YM8Lr…`, `FT4GQq…`, `AfF3SJF…` — internal wallet cluster.
- `y9pM263…` / `Bgq7tr…` — Kamino reserve vault.
- `GwknKVv…` / `F3yP3uE1…` — holding MNDE reserves for the custom program before funds return to wallet/operator.
- `3nMNd89…`, `ByXmPDE…` etc. — ephemeral accounts spun by the orchestrator per mint cycle (likely closable PDAs representing CLMM positions).

---

## 6. Transaction Flow Diagram (Logical)
```
Wallet (MNDE/USDC)
   |  (send MNDE)
   v
Custom Program 6LtLpn…
   ├──> Orca Whirlpool (whirLb…)
   ├──> SPL Token (Tokenkeg…)
   └──> Helper accounts {2bhk…, ARu4n…, 2YM8Lr…}
            |
            └── stores rewards / pays fees
   ^
   |  (receive USDC)
Jupiter route (JUP6Lkb…)
   ├──> Raydium CLMM (CAMMC…/LBUZ…)
   └──> Returns MNDE to wallet

Kamino flash bundle (periodic)
   Wallet ↔ KLend2g3… (flash borrow USDC)
               └─> Raydium CLMM manager adjustments
```

---

## 7. Operational Characteristics
- **Latency posture**: No evidence of Jito bundles or aggressive priority fees; ComputeBudget instructions typically set CU price ≤ 2 000 lamports. Bot relies on deterministic order flow rather than priority racing.
- **Capital efficiency**: Hot wallet floats minimal balances (5–50 USDC, 20–50 MNDE). Custom program spins PDAs to custody bulk rewards, limiting attack surface if hot wallet compromised.
- **Automation cadence**: Mint+swap pairs fire in bursts (2–3 per minute) then idle; timed with MNDE emission accrual windows. Flash loans appear after price moves to re-range LP or to harvest built-up fees.
- **Fee siphoning**: `2YM8Lr…` receives consistent dust token payouts (`12Uj74…`, `5PHS5w…`) — likely developer fee account.

---

## 8. Reverse Engineering Notes
1. **Identify custom program**: Pull the IDLs for `6LtLpn…` and `proVF4…` via `solana program dump` or Anchor IDL fetch. Instruction data shows long serialized payloads (likely struct with reward accounts). Understanding these reveals exact claim formula.
2. **Map LP positions**: The accounts touched in mint legs include Whirlpool position NFTs (`Ag3hiK9…`) and Raydium CLMM positions. Query those accounts to copy liquidity parameters.
3. **Quantify spread**: Pair each mint signature with the following swap (same timestamp window) and track MNDE price using a market API (Birdeye/Jupiter quote). Expect ~20–40 bps edge per loop.
4. **Emulate**: To clone wallet behavior you need:
   - MNDE ATA loaded with 30–50 MNDE
   - Custom program deployment (probably private) or equivalent script that interacts with the same vault accounts
   - Automated Jupiter swap using the minted USDC to rebuy MNDE instantly
   - Optional Kamino flash-loan script if you control the same CLMM positions

---

## 9. Notable Addresses (Label Suggestions)
| Address | Role |
|---------|------|
| `2ZzxuHxvPQtPU48Tffs8LD8sy17rgjBRQviRVxQ54fR6` | Settlement wallet (this report) |
| `AfF3SJFpyfU7iw9KtrwPyi6corJbyiC24JyVis7oxNVr` | Wallet MNDE ATA |
| `FT4GQqs5sEvqhsWm845VF1vmHjdQkrB1jdsGPJbzB4oB` | Wallet USDC ATA |
| `2bhkQ6uVn32ddiG4Fe3DVbLsrExdb3ubaY6i1G4szEmq` | Reward aggregator account |
| `ARu4n5mFdZogZAravu7CcizaojWnS6oqka37gdLT5SZn` | Program PDA (claims vault) |
| `2YM8LrJGRtsDcWeqsjX2EQwJfhArxyDdtDzgt7vrwwbV` | Fee collector (receives dust tokens) |
| `6LtLpnUFNByNXLyCoK9wA2MykKAmQNZKBdY8s47dehDc` | Custom orchestrator program |
| `proVF4pMXVaYqmy4NjniPh4pqKNfMmsihgd4wdkCX3u` | Companion program (likely Anchor) |
| `whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc` | Orca Whirlpool router |
| `CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK` | Raydium CLMM whirlpool manager |
| `KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD` | Kamino lending program |

---

## 10. Actionable Follow-ups
1. **Dump program data**: Run `solana program dump` on `6LtLpn…` and attempt IDL reconstruction for full instruction semantics.
2. **Track helper balances**: Monitor `2bhk…`, `ARu4n…`, and `2YM8Lr…` for true profit accumulation; correlate with MNDE/USD pricing to estimate operator revenue.
3. **Automate pairing**: Build a script that watches for `TOKEN_MINT` from `6LtLpn…`, logs following Jupiter swap signature, and exports per-loop P&L including market slippage.
4. **Security considerations**: Wallet leaves minimal capital exposed; to replicate safely mimic this structure—hot wallet only signs, while positions stay in PDAs.

---

_All numbers are wallet-internal and exclude value locked in auxiliary accounts. For replication or deeper forensic work, inspect the raw dataset referenced above._
