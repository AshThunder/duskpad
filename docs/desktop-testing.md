# Desktop testing with real wallet extensions

Everything in DuskPad has run against a local ledger-8 network using dev wallets that implement the DApp Connector v4 interface. The real **1AM** and **Lace** extensions have **not** been tested yet. This checklist covers that gap.

## Setup

1. Install 1AM (primary) and/or Lace in a desktop Chrome profile. Create a wallet on **Preprod** with test funds only.
2. On Preprod, deploy tUSD and register it (see README, "Preprod"), or point the wallet at a local undeployed node if the extension supports custom endpoints.
3. Build the app with `VITE_NETWORK=preprod npm run build:web` and serve it with `npm run preview:web`, pointing `VITE_API_URL` at a reachable API.

## Checklist

| # | Check | Expected |
|---|---|---|
| 1 | Connect modal lists 1AM first, then Lace | Both detected from `window.midnight` |
| 2 | Connect 1AM | Network check passes (`getConfiguration().networkId === 'preprod'`); address and balances shown |
| 3 | Credential page: request a mock credential | Stored in the vault; the issuer request contains only commitment, country and level |
| 4 | Dashboard: mint tUSD | 1AM prompts once; shielded balance increases |
| 5 | Create Sale | The deploy stepper reaches "Submit"; the sale appears in Explore after the indexer catches up |
| 6 | Buy a ticket | 1AM proves in-extension (`getProvingProvider`) or falls back to the proof server; the stepper shows each stage |
| 7 | Same with Lace | Lace balances and submits; proving uses the proof server |
| 8 | Refund / withdraw / collect fee / claim | Each completes; balances update in the wallet UI |
| 9 | Export the backup, then import it with a second wallet and claim | Tokens arrive in the second wallet |
| 10 | Reject a prompt in the extension | The stepper stops with a readable error; the app stays usable |

Report any mismatch in amounts, encodings (bigint vs string) or connector method names. Those are the most likely integration points.
