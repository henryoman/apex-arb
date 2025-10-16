# APEX ARB v2.1 — USDC/MEME/USDC Arbitrage Bot

<p align="center">
  <img src="https://img.shields.io/badge/Solana-Mainnet-14F195?style=for-the-badge&logo=solana&logoColor=white">
  <img src="https://img.shields.io/badge/Jito-Bundles-000000?style=for-the-badge">
  <img src="https://img.shields.io/badge/License-MIT-000000?style=for-the-badge">
</p>

![](https://github.com/user-attachments/assets/f1068b9e-ec48-412f-bb3e-591ad6a2b4e6)

## What is this?

### 🚀 ApexArb is a CLI arbitrage bot that scans meme tokens and attempts a round-trip swap (USDC → MEME → USDC) via Jupiter (Free or Ultra).
It calculates net profit (slippage, estimated Jupiter fee, priority fee + Jito tip), applies DEX filters, prints candidates with beautiful log cards, and optionally executes live trades.

## ✨ Features
- 🔄 Dual quoting: `/swap/v1/quote` for BUY & SELL.
- 📊 Net PnL calculation with fees & slippage.
- 🎯 Route filtering (INCLUDE / EXCLUDE DEX).
- 🛡 DRY_RUN simulation with transaction `simulateTransaction` preview.
- 📈 Snapshot telemetry & structured log files per session.
- ⚡ Optional Jito bundle submissions (relayer mode).

---

## 📦 Quick Start (Bun)

```
bun install
cp .env.example .env
# edit .env with your RPC + prefs

# Dry run (recommended first)
DRY_RUN=true JITO_MODE=off bun dev

# Live execution (requires PRIVATE_KEY_B58 etc.)
DRY_RUN=false bun start
```

Every `bun dev` session writes to `logs/session-*.log` with the exact console stream.

### Dry-Run Best Practices
- Keep `DRY_RUN=true` and `JITO_MODE=off` to simulate without touching bundles.
- Use `JITO_MODE=relayer` plus a dummy `JITO_TIP_ACCOUNT` if you want to test relayer logging while staying dry.
- The bot now calls `simulateTransaction` for both BUY and SELL legs; watch the `SIM BUY` / `SIM SELL` lines for compute usage and last logs.
- Snapshot output (`📈 SNAPSHOT`) includes `errors` so you can spot failing routes quickly.

---

![](https://github.com/user-attachments/assets/8ac51f7b-b0be-4c29-bc0d-16cce0c14967)

---

📊 Token List (memes.txt)

One mint per line:

```
So11111111111111111111111111111111111111112
9n4nbM75f5Ui33ZbPYXn59EwSgE8CGsHtAeTH5YFeJ9E
...

```

The bot loads it on startup.

```

## Bot


 █████╗ ██████╗ ███████╗██╗  ██╗     █████╗ ██████╗ ██████╗ 
██╔══██╗██╔══██╗██╔════╝╚██╗██╔╝    ██╔══██╗██╔══██╗██╔══██╗
███████║██████╔╝█████╗   ╚███╔╝     ███████║██████╔╝██████╔╝
██╔══██║██╔═══╝ ██╔══╝   ██╔██╗     ██╔══██║██╔══██╗██╔══██╗
██║  ██║██║     ███████╗██╔╝ ██╗    ██║  ██║██║  ██║██████╔╝
╚═╝  ╚═╝╚═╝     ╚══════╝╚═╝  ╚═╝    ╚═╝  ╚═╝╚═╝  ╚═╝╚═════╝ 
                S O L A N A  ARBITRAGE  v 2.1
                     github.com/apexarb
----------------------------------------------------------------------------------------------------
🌈 ApexArb Launching…
USDC ↔ MEME ↔ USDC Arbitrage — Jupiter [FREE]
ℹ️  [i] RPC: https://… | ℹ️  [i] MODE: both | ℹ️  [i] DRY_RUN: true
ℹ️  [i] BUY $: 50 | MIN_NET: $0.50 | SLIPPAGE: 0.50%
ℹ️  [i] DEX Allow (all): raydium, orca (aliases enabled)
----------------------------------------------------------------------------------------------------

🎯 CANDIDATE  7d3A…kP9u   net $0.41
back $50.41   size $50.0000   slip 0.50%
priority 10000+2000 lamports
BUY: raydium > orca  SELL: orca > raydium

[9f1c…Qx7Z] ⚠️  [!] SKIP net +$0.4140 | back $50.4140 | size $50.0000 | slippage 0.50% | priority 10000+2000 lamports |
    BUY: meteora  SELL: meteora > raydium

📈 SNAPSHOT (1m) | spreads=186 | candidates>=min=9 | executed=0 | bestNet=$0.41 | avgNet=$0.37 | nearMiss(≤$0.10)=4
----------------------------------------------------------------------------------------------------

🟢 BUY SENT        5GkQ3…ZkTt8Y4oWgB1J7eNwLx…
🔵 SELL SENT       2v9mP…dRTwqW7N1gCkz3p6Um…

```

## Troubleshooting

Key missing / format error
Ensure exactly one of PRIVATE_KEY_B58 is present and valid. (.env.example -> .env)

429 Too Many Requests (Jupiter/RPC)
Expected under load. The bot uses jitter/backoff automatically; add more/better RPCs.

Jito auth/relay issues
Verify JITO_BUNDLE_RELAYS and JITO_AUTH. If bundles aren’t available, the bot falls back to sequential mode.

## Production Tips

Keep MAX_PARALLEL tuned to your CPU/RPC limits.
Use INCLUDE_DEXES/EXCLUDE_DEXES to filter noisy pools.
For ULTRA mode, supply JUP_API_KEY and watch the fees.
Enable JITO_MODE=relayer on volatile tokens for better inclusion. 

---

![](https://github.com/user-attachments/assets/75bdba5e-254c-4e74-96b0-ca490ade1c68)

> [!NOTE]
> This is provided as is, for learning purposes.
> Use this script at your own risk.

