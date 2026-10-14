# Desktop testing with real wallet extensions

Everything in DuskPad has run against a local ledger-8 network using dev wallets that implement the DApp Connector v4 interface. The real **1AM** and **Lace** extensions still need a person at a desktop browser. This page is the script for that run.

## What the app does for real wallets

- Discovers wallets in `window.midnight` (1AM: `window.midnight['1am']`, Lace: `window.midnight.mnLace`) and lists 1AM first.
- `connect('preprod')` is the first call in the click handler (Lace opens its pop-up only from a user gesture; Lace is never auto-reconnected).
- Shielded keys are accepted as hex (dev wallets) or Bech32m (`mn_shield-cpk_…` / `mn_shield-epk_…`, what the v4 spec and Lace return) and cross-checked against the shielded address. Balances are normalised to bigint whatever the wallet returns.
- Endpoints come from the wallet's `getConfiguration()`. The indexer is probed first; if it does not answer the app uses `indexer.preprod.midnight.network`. Expect "Indexer: default" for both wallets: 1AM's indexer (`api-preprod.1am.xyz`) needs a 1AM session token (401 for dapps), and Lace's Blockfrost proxy returned 410 Gone when tested. Both serve the same chain.
- Proving: the wallet's `getProvingProvider` when offered (1AM proves in the extension, ProofStation). If it is missing or fails for a technical reason (not a rejection), the app proves on a proof server: the wallet's `proverServerUri` if it answers, otherwise the app's `/prover` proxy to the box's proof server 8.1.0. The Dashboard "Wallet connection" card shows which one was used.
- Balancing and fees go through `balanceUnsealedTransaction` (1AM adds sponsored DUST), then `submitTransaction`.
- Deploys use `createUnprovenDeployTx` + `submitTxAsync` and confirm by polling the indexer, not the blocking `deployContract`.

## URLs on the box

| Build | URL | Network |
|---|---|---|
| Preprod | http://127.0.0.1:4174 | `preprod` (`npm run build:web:preprod`, `npm run preview:web:preprod`) |
| Local | http://127.0.0.1:4173 | `undeployed` (dev wallets, or 1AM/Lace switched to "Undeployed") |

Both proxy `/api` to the DuskPad API on :8787 and `/prover` to the proof server on :6300. Static ZK assets are served with `Access-Control-Allow-Origin: *`.

## Funding

| Wallet | tNIGHT | DUST | tUSD |
|---|---|---|---|
| 1AM (Preprod) | Optional: 1AM can sponsor DUST fees through ProofStation. The faucet works too | Sponsored, or the wallet's own DUST after registering tNIGHT | Mint in the app (Dashboard → Mint 5,000 tUSD) after the one-time setup |
| Lace (Preprod) | https://faucet.preprod.midnight.network/ (Cloudflare Turnstile; in the box browser it passed automatically) | In Lace, designate the tNIGHT for DUST and wait until DUST shows. It accrues over time and Lace syncs slowly, so allow 10+ minutes | Mint in the app |
| Either wallet on the local build | `npm run fund:local -- <mn_addr_undeployed1…> [--amount 1000]` sends tNIGHT from the local genesis wallet | Register in the wallet and wait | Mint in the app |

## Steps (Preprod, http://127.0.0.1:4174)

Before starting, fund Lace (step 11) so its DUST is ready while you test 1AM: both sales below stay open for 20 minutes.

### A. 1AM

1. In 1AM, select the **Preprod** network. Any proof-server mode works: WASM (in-browser) and ProofStation both go through `getProvingProvider`; if in-browser proving fails or exceeds 1AM's 5-minute limit, the app re-proves on the box's proof server and says so on the Dashboard card. Open http://127.0.0.1:4174.
2. **Checklist 1.** Click Connect: 1AM is listed first, then Lace (both "Detected").
3. **Checklist 2.** Click 1AM and approve. Expected: the navbar shows the address; Dashboard shows tUSD 0, DUST ("fees sponsored by 1AM") and a "Wallet connection" card with API 4.x, wallet proving "supported".
4. **One-time setup** (only if the yellow "not set up on this network" banner shows). Open `/setup`: click Generate for the platform master secret and Download it, then "Deploy tUSD on Midnight Preprod". 1AM opens two prompts, **Balance & Sign** and then **Submit Transaction**: approve the second one immediately (see "1AM's sponsored fee window" below). The page waits for the indexer, records the deployment with the API, and turns green.
5. **Checklist 3.** Get verified: request a mock credential (e.g. Nigeria, level 2). It is stored in the vault.
6. **Checklist 4.** Dashboard → Mint 5,000 tUSD. Approve once; after confirmation the shielded tUSD balance shows 5,000.
7. **Checklist 5.** Launch: create a sale for the refund path: price 100, hard cap 100, **soft cap 20** (you will not reach it), start in 2 minutes, duration **20 minutes**, cliff 1 minute, 1 tranche. Approve. The stepper confirms, the sale page opens, and it is listed in Sales.
8. Create a second sale for the success path: price 100, hard cap 3, **soft cap 1**, start in 2 minutes, duration 20 minutes, cliff 1 minute, **2 tranches 2 minutes apart**.
9. **Checklist 6.** When each sale is live, buy one ticket in each. The stepper shows run → prove → balance → submit → confirm; the Dashboard card shows "Last proof: in the wallet" (or "proof server" with the reason if 1AM's proving failed). tUSD drops by 100 per ticket.
10. **Checklist 10.** Start one more action (e.g. mint) and press Reject in 1AM. The stepper stops with "The wallet rejected the request." and the app keeps working.

### B. Lace

11. Fund Lace first: get tNIGHT from the faucet, designate it for DUST in Lace, wait for DUST to show. In Lace Settings → Midnight, set the proof server to **Local** (`http://localhost:6300`): the box runs proof server 8.1.0 (ledger 8) there and answers CORS for both the page and the extension.
12. Disconnect 1AM in the app (navbar → disconnect), reload, and connect **Lace** with network Preprod. **Checklist 7.** The Dashboard card shows the indexer source ("default" if Lace's own indexer did not answer) and proving "proof server" if Lace offers no proving provider. Mint tUSD, get a credential (the vault is per wallet unless you link it), and buy a ticket in the success sale while it is still open.

### C. After the sales end (about 22 minutes after creation)

13. **Checklist 8.** On each sale page press Finalize (anyone can).
    - Refund sale (soft cap missed): the buyer wallet refunds its ticket; tUSD comes back.
    - Success sale: the creator wallet (1AM) withdraws proceeds; the Platform page → "Load saved key" (the secret from setup) → Collect fee; after the cliff the 1AM buyer claims **tranche 1** from the Dashboard (Lace can claim its own ticket too).
14. **Checklist 9.** With 1AM connected: Dashboard → Export backup (passphrase). Switch to Lace, Dashboard → Import backup, select the restored vault, then claim **tranche 2** of the 1AM ticket from Lace. The tokens arrive in Lace although Lace never bought.

## Fallback: real wallets on the local node

1AM 6.3.24 has a built-in **Undeployed** network (indexer `http://localhost:8088/api/v4/graphql`, node `ws://localhost:9944`, proof server `http://localhost:6300`), exactly the box's local stack. Lace's Midnight settings also list Undeployed with the same ports. So:

1. Switch the wallet to Undeployed and copy its unshielded address (`mn_addr_undeployed1…`).
2. `npm run fund:local -- mn_addr_undeployed1…` (sends 1,000 tNIGHT from genesis), then register DUST in the wallet. There is no fee sponsorship locally.
3. Use http://127.0.0.1:4173 (tUSD and the platform key are already set up by the local bootstrap) and run the same checklist.

## Checklist

| # | Check | Expected |
|---|---|---|
| 1 | Connect modal lists 1AM first, then Lace | Both detected from `window.midnight` |
| 2 | Connect 1AM | Network check passes (`networkId === 'preprod'`); address and balances shown |
| 3 | Credential page: request a mock credential | Stored in the vault; the issuer request contains only commitment, country and level |
| 4 | Dashboard: mint tUSD | 1AM prompts once; shielded balance increases |
| 5 | Create Sale | The deploy stepper confirms; the sale appears in Explore |
| 6 | Buy a ticket | 1AM proves in-extension (`getProvingProvider`) or falls back to the proof server; the stepper shows each stage |
| 7 | Same with Lace | Lace balances and submits; proving uses the proof server if Lace offers no proving provider |
| 8 | Refund / withdraw / collect fee / claim | Each completes; balances update in the wallet UI |
| 9 | Export the backup, then import it with a second wallet and claim | Tokens arrive in the second wallet |
| 10 | Reject a prompt in the extension | The stepper stops with a readable error; the app stays usable |

## 1AM's sponsored fee window (node error 182)

With Dust Sponsorship on (1AM's default), ProofStation adds the DUST fee as a separate intent whose TTL
is about 48 seconds after the sponsor's view of the chain tip. 1AM then asks for "Submit Transaction" in
a second prompt. If that approval comes after the fee intent's TTL, the node rejects the whole
transaction with `1010: Invalid Transaction: Custom error: 182` (an expired intent TTL; Midnight node
1.0.x reports all intent-TTL failures as 182). The first real-wallet run hit exactly this: the fee intent
expired at 12:41:42 WAT and 1AM submitted at 12:42:15 WAT.

What DuskPad does about it:
- it hands 1AM back the exact balanced hex 1AM returned, so 1AM finds its sponsored record;
- while 1AM waits for "Submit Transaction" the stepper shows a countdown of the fee's remaining validity;
- if the window has already closed, or the node answers 182, DuskPad asks 1AM to balance the same
  transaction again (up to two more times; a deploy keeps its contract address) and re-submits;
- the error names the prover, the indexer and the wallet that were used.

If you are slow on the prompts, or want to avoid the window entirely and the wallet has its own DUST,
turn off **Settings → Dust Sponsorship** in 1AM: its own fee intent then has a 30-minute TTL.

## Buying with 1AM: choose "Pay with My Dust"

1AM shows **"Dust Sponsorship Failed: Unable to prepare unsealed DApp transaction for sponsored DUST"** on
every ticket purchase. In 1AM 6.3.24 the sponsored path (`balanceUnsealedTransaction` → sign →
`balanceUnboundTransaction` with token kinds `["shielded"]`) throws exactly this error whenever the wallet
has to add a balancing transaction of its own, that is, whenever the wallet must contribute coins. A
purchase pays the sale in shielded tUSD from the buyer's wallet, so 1AM must add shielded inputs and change
(which it then has to prove itself); only transactions that need nothing from the wallet except the fee can
be sponsored. Deploys and mints are confirmed sponsorable. Finalize, refund, claim, withdraw and collect fee
should be too, because the contract pays out and the wallet adds no coins, but they have not been tried with
1AM yet; if one of them shows the same dialog, the same answer applies. This cannot be changed on the
DApp side without the contract taking the buyer's coins some other way, and coins can only leave a wallet
through the wallet's own spends.

Choose **Pay with My Dust** in that 1AM dialog. 1AM then balances with the wallet's own DUST, proving locally,
and the purchase goes through. This needs DUST in the wallet. The buy stepper shows this note whenever the
connected wallet is 1AM.

## "A transaction is already pending"

This message comes from 1AM, not DuskPad: 1AM turns ProofStation's `PENDING_TRANSACTION` answer into
"A transaction is already pending. Wait for it to confirm or expire before requesting another." The sponsor
allows one pending sponsored transaction per wallet. DuskPad now (1) waits, before asking the wallet to balance,
until the previous transaction it submitted is on the indexer (up to 3 minutes; the stepper says so), and
(2) if 1AM still answers "already pending", retries balancing up to 3 times, 30 s apart, with a countdown.
Each retry shows 1AM's **Balance & Sign** prompt again.

## Known risks to watch

- **Buying with 1AM**: confirmed working on Preprod (1AM adds the shielded tUSD inputs; 5000 → 4900). The DUST fee cannot be sponsored, see below.
- **Lace builds differ**: older Lace releases may lack `getProvingProvider`/`signData` (handled by the proof-server fallback) and default to an indexer URL that is gone (handled by the probe).
- **Wallet timeouts**: 1AM gives up on a request after 5 minutes; the app then proves on the proof server.

Report any mismatch in amounts, encodings or connector method names, with the text of the Dashboard "Wallet connection" card.
