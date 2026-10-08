# DuskPad e2e matrix: latest run (2026-10-08T09-58-23-344Z)

Local ledger-8 network (midnight-node 1.0.400, indexer 4.3.5, proof-server 8.1.0), Compact 0.31.1, Midnight.js 4.1.1. Real proofs, real wallets, real blocks.

**47/47 passed**: 44/44 rows of the feasibility matrix plus 3 DuskPad extras (X-*). Rows marked (adapted) differ from the research matrix because DuskPad's design removes the original attack surface; the reason is in the test name.

*circuit* = the local circuit refused, so no proof could exist and nothing was submitted. *ledger* = two transactions built from the same state; the chain accepted exactly one and included the other with its fallible segment failed.

| ID | Test | Result | Where enforced | s |
|---|---|---|---|---|
| P1 | Simulator probes (valid buy, second buy, tampered attribute, stolen credential, blocked country, second person) | PASS: 6/6  | simulator | 0 |
| SETUP-1 | Local ledger-8 stack; buyer A, buyer B, project, platform, fresh and connector wallets funded (tNIGHT) with DUST registered | PASS: 6 wallets synced, funded and generating DUST | chain | 86 |
| A-0 | Same domain separator in another contract gives a different token color | PASS: tUSD 9d8651787ccd… vs FAKE 1d9770142130… | ledger | 37 |
| A-0b | (adapted) Token colors are derived off-chain from the deployed address: minted coins land under rawTokenType(domain, address) | PASS: A holds 10000000000 base units under 9d8651787ccd… (constructor never computes a color) | chain and wallet | 48 |
| A-1 | Shielded tUSD minted to buyer A and buyer B | PASS: A +10000, B +10000 | chain | 0 |
| A-2a | Contract output to a non-caller key without its encryption key | PASS: rejected ("encryption public key/Unable to resolve") | Midnight.js | 0 |
| A-2b | Contract output to a non-caller key with additionalCoinEncPublicKeyMappings | PASS: B 10000 -> 10500 | chain and wallet | 24 |
| W-1 | DApp Connector v4 ConnectedAPI path: deploy a sale | PASS: sale c0e2dd37e644ec33… | chain | 17 |
| W-2 | DApp Connector path: shielded mint; getShieldedBalances() shows it | PASS: 0 -> 5000 | chain and wallet | 24 |
| W-3 | DApp Connector path: private buyTicket, wallet adds tUSD inputs in balanceUnsealedTransaction | PASS: 5000 -> 4000, ticketsSold=1 | chain | 26 |
| C-1 | A and B each buy 1 ticket with shielded tUSD | PASS: A -1000, B -1000, vault 2, nullifiers 2 | chain | 58 |
| C-2 | A buys a 2nd ticket (per-person max = 2) | PASS: ticketsSold=3 | chain | 24 |
| F-1 | Credential signed by a non-issuer key | PASS: rejected ("bad issuer signature") | circuit | 0 |
| F-2 | KYC level below minimum | PASS: rejected ("kyc level too low") | circuit | 0 |
| F-5 | 3rd ticket for the same person (over the per-person cap) | PASS: rejected ("per-person ticket cap reached") | circuit | 0 |
| F-6 | Same person reuses ticket index 0 | PASS: rejected ("ticket index already used") | circuit | 0 |
| F-7 | A's credential and holder secret used from B's wallet | PASS: rejected ("ticket index already used") | circuit | 0 |
| F-8 | Blocked country | PASS: rejected ("blocked region") | circuit | 0 |
| F-9 | Stolen credential (wrong holder secret) | PASS: rejected ("credential not bound to this holder") | circuit | 0 |
| F-10 | Wrong coin color (FAKE token, same "tUSD" domain, different contract) | PASS: rejected ("wrong payment token") | circuit | 0 |
| F-11 | Wrong amount (999) | PASS: rejected ("wrong payment amount") | circuit | 0 |
| X-1 | (extra) Expired credential | PASS: rejected ("credential expired") | circuit | 0 |
| F-12 | Race: same person and ticket index submitted at once from 2 wallets (same state) | PASS: accepted=1, charged wallets=1, ticketsSold=4; loser included on-chain as FailFallible (tx 00ec9fe29a6d…) | ledger | 48 |
| S1-W | Withdraw while the sale is live | PASS: rejected ("sale did not succeed") | circuit | 0 |
| X-3 | (extra) Auditor disclosure: auditor key decrypts each ticket to the buyer's credential commitment | PASS: 4 records: A 2, B 1, R 1 | off-chain | 0 |
| F-13 | Buy when sold out | PASS: rejected ("sold out") | circuit | 0 |
| E-0 | Finalize S2 early on hard cap with soft cap met | PASS: phase=succeeded, sold=4 | chain | 19 |
| E-1 | Claim before cliff | PASS: rejected ("tranche still locked") | circuit | 0 |
| E-2 | Refund when the soft cap was met | PASS: rejected ("refunds not open") | circuit | 0 |
| E-3 | Withdraw by a non-project wallet | PASS: rejected ("not the project") | circuit | 0 |
| E-4 | (adapted) Withdraw a forged coin that is not in the vault (the fee split itself is fixed in-contract) | PASS: rejected ("not a vault coin") | circuit | 0 |
| E-5 | Project withdraws all 4 ticket coins net of 2.5% | PASS: project +3900; fee vault 4 x 25; withdrawn=4 | chain | 108 |
| E-6 | Fee collection by a non-platform wallet | PASS: rejected ("not the platform") | circuit | 0 |
| E-7 | Platform collects fees | PASS: platform +100 | chain | 96 |
| E-10 | Conservation: buyers paid 4,000 = project 3,900 + platform 100 | PASS: paid 4000 = received 4000 | chain | 0 |
| F-4 | Buy after end time | PASS: rejected ("sale ended") | circuit | 0 |
| D-0 | Finalize S1 after end with soft cap missed | PASS: phase=failed, sold=4 < soft cap 5 | chain | 17 |
| D-1 | Buyer A refund | PASS: A 6000 -> 7000 | chain | 31 |
| D-2 | Buyer B refund | PASS: B 6500 -> 7500 | chain | 24 |
| D-3 | Double refund, same receipt (sequential) | PASS: rejected ("receipt already used for this") | circuit | 0 |
| D-4 | Race: double refund of the same receipt from 2 wallets, different vault coins | PASS: accepted=1; loser included on-chain as FailFallible (tx 0000e5d61574…) | ledger | 29 |
| D-5 | After the race: no double payout (refunds = tickets, vault empty, 4 receipt nullifiers) | PASS: refundsPaid=4, sold=4, vault=0, receiptNullifiers=4 | chain | 24 |
| X-4 | (extra) Tranche 2 stays locked until cliff + interval | PASS: rejected ("tranche still locked") | circuit | 0 |
| E-8 | Claims after cliff mint sale tokens (tranche 1 = 50 per ticket) | PASS: A +100, B +50 (color 9e01851d1843…) | chain | 71 |
| E-9 | Double claim (sequential) | PASS: rejected ("receipt already used for this") | circuit | 0 |
| E-11 | Fresh wallet (never bought, no tUSD) claims with a receipt secret | PASS: fresh wallet sale tokens 0 -> 50; its tUSD = 0 | chain | 24 |
| E-12 | Race: double claim of the same receipt and tranche from 2 wallets | PASS: accepted=1, claimsPaid=5; loser included on-chain as FailFallible (tx 00d751270ff7…) | ledger | 24 |
