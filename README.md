# Soroban Security Auditor — AI Agent with Autonomous On-Chain Payments

> A production-grade AI agent that audits Soroban smart contracts and pays for every audit autonomously — no subscriptions, no API keys, no human approval. Built on Stellar's x402 and Stripe MPP payment protocols.

Built for **[Stellar Hacks: Agents](https://dorahacks.io/hackathon/stellar-agents-x402-stripe-mpp/detail)** — April 2026.

---

## What It Does

An AI agent (Claude Code, or any MCP-compatible agent) reads your Soroban `.rs` contract, pays **0.15 USDC on Stellar Testnet** in a single autonomous transaction, and returns a structured security report with CWE IDs, severity levels, and exact code fixes — all without a human touching a wallet.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                        AI AGENT  (Claude Code)                       │
│                                                                      │
│   "Audit this Soroban contract for vulnerabilities"                  │
│   → calls MCP tool: audit_soroban_contract_mpp                       │
└────────────────────────┬─────────────────────────────────────────────┘
                         │ MCP stdio (tool call)
                         ▼
┌──────────────────────────────────────────────────────────────────────┐
│                      MCP SERVER  (auditor-mcp)                       │
│                                                                      │
│  Tools exposed to agents:                                            │
│  • audit_soroban_contract      — pays via x402 protocol              │
│  • audit_soroban_contract_mpp  — pays via Stripe MPP protocol        │
│                                                                      │
│  Payment clients:                                                    │
│  • x402Client + ExactStellarScheme  (Stellar Ed25519 signer)         │
│  • MppxClient + stellar.charge()    (Stellar SAC transfer)           │
│                                                                      │
│  Wallet: agent's Stellar keypair, pre-funded with USDC (testnet)     │
└────────────┬───────────────────────────────────────┬────────────────┘
             │ HTTP POST                              │ HTTP POST
             │ x402 flow ──────────────────┐          │ MPP flow ───────────────┐
             ▼                             ▼          ▼                         ▼
┌────────────────────────┐   ┌────────────────────────────┐   ┌────────────────────────────┐
│  PAYMENT FACILITATOR   │   │     STELLAR TESTNET        │   │     STELLAR TESTNET        │
│  (OpenZeppelin x402)   │   │     (USDC SAC Transfer)    │   │     (USDC SAC Transfer)    │
│                        │   │                            │   │                            │
│  Verifies Stellar      │   │  mppx challenge issued     │   │  SAC transfer submitted    │
│  auth entry on-chain   │   │  client signs + pays       │   │  mppx verifies receipt     │
│  Settles to server     │   │  Settles to server wallet  │   │  Settles to server wallet  │
└────────────┬───────────┘   └──────────────┬────────────┘   └──────────────┬─────────────┘
             │ verified                      │ verified                      │ verified
             └──────────────────┬────────────┘                              │
                                │                                           │
                                ▼                                           ▼
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│                    AUDITOR BACKEND  (Express.js — port 3001)                             │
│                                                                                          │
│  POST /api/audit      — x402 paywall via paymentMiddleware + ExactStellarScheme          │
│  POST /api/audit/mpp  — MPP paywall  via mppAuditPaywall  (mppx + @stellar/mpp)         │
│                                                                                          │
│  Price: 0.15 USDC · Network: stellar:testnet · Facilitator: OpenZeppelin Built-on-Stellar│
└────────────────────────┬─────────────────────────────────────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────────────────┐
│                      AI AUDIT ENGINE  (Groq)                         │
│                                                                      │
│  Model: llama-3.3-70b-versatile                                      │
│                                                                      │
│  Pass 1 — Chain-of-thought reasoning                                 │
│    Traces every function: authorization, arithmetic, storage,        │
│    error handling, cross-contract calls, events                      │
│                                                                      │
│  Pass 2 — Structured JSON extraction                                 │
│    Converts reasoning → findings with CWE IDs,                       │
│    severity, confidence score, affected function, exact fix          │
│                                                                      │
│  Taxonomy: Sanctifier S001–S012, OpenZeppelin Stellar Contracts,     │
│            CoinFabrik Scout, CVE GHSA-PM4J-7R4Q-CCG8                │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Sequence Diagrams

### x402 Payment Flow

```
Agent (Claude Code)        MCP Server              Auditor Backend       Stellar Testnet
        │                      │                         │                      │
        │  audit_soroban_      │                         │                      │
        │  contract(file_path) │                         │                      │
        │─────────────────────>│                         │                      │
        │                      │─── readFile(path) ──>   │                      │
        │                      │                         │                      │
        │                      │  POST /api/audit        │                      │
        │                      │  { code: "..." }        │                      │
        │                      │────────────────────────>│                      │
        │                      │                         │                      │
        │                      │     HTTP 402            │                      │
        │                      │     WWW-Authenticate:   │                      │
        │                      │     scheme=exact        │                      │
        │                      │     price=0.15 USDC     │                      │
        │                      │     payTo=GDJUT...      │                      │
        │                      │<────────────────────────│                      │
        │                      │                         │                      │
        │                      │  Signs Stellar auth     │                      │
        │                      │  entry (Ed25519 key)    │                      │
        │                      │  0.15 USDC transfer ────────────────────────> │
        │                      │                         │                      │
        │                      │  OpenZeppelin facilitator verifies on-chain    │
        │                      │  ──────────────────────────────────────────── │
        │                      │                         │                      │
        │                      │  POST /api/audit        │                      │
        │                      │  X-PAYMENT: <receipt>   │                      │
        │                      │────────────────────────>│                      │
        │                      │                         │  AI audit (2-pass)   │
        │                      │                         │  ~15–20s             │
        │                      │     HTTP 200            │                      │
        │                      │     { findings: [...] } │                      │
        │                      │<────────────────────────│                      │
        │  Structured report   │                         │                      │
        │<─────────────────────│                         │                      │
```

### Stripe MPP Flow

```
Agent (Claude Code)        MCP Server              Auditor Backend       Stellar Testnet
        │                      │                         │                      │
        │  audit_soroban_      │                         │                      │
        │  contract_mpp(path)  │                         │                      │
        │─────────────────────>│                         │                      │
        │                      │─── readFile(path) ──>   │                      │
        │                      │                         │                      │
        │                      │  mppClient.fetch()      │                      │
        │                      │  POST /api/audit/mpp    │                      │
        │                      │────────────────────────>│                      │
        │                      │                         │                      │
        │                      │     HTTP 402            │                      │
        │                      │     MPP challenge       │                      │
        │                      │     (HMAC-signed ID,    │                      │
        │                      │      0.15 USDC, SAC     │                      │
        │                      │      stellar:testnet)   │                      │
        │                      │<────────────────────────│                      │
        │                      │                         │                      │
        │                      │  stellar.charge()       │                      │
        │                      │  SAC transfer 0.15 USDC ────────────────────> │
        │                      │                         │                      │
        │                      │  Credential header built from Stellar receipt  │
        │                      │  POST /api/audit/mpp                           │
        │                      │  X-MPP-Credential: ...  │                      │
        │                      │────────────────────────>│                      │
        │                      │                         │  mppx verifies       │
        │                      │                         │  SAC receipt ──────> │
        │                      │                         │                      │
        │                      │                         │  AI audit (2-pass)   │
        │                      │     HTTP 200            │  ~15–20s             │
        │                      │     { findings: [...] } │                      │
        │                      │<────────────────────────│                      │
        │  Structured report   │                         │                      │
        │<─────────────────────│                         │                      │
```

---

## Value Propositions

### Scenario 1 — DeFi Protocol Launch

**Real World Scenario:** A DeFi team ships a Soroban lending protocol. A security audit from Trail of Bits or OpenZeppelin costs $20,000–$80,000 and takes 4–8 weeks. They can't afford to wait — the hackathon or launch window is now.

**Action:** They configure the auditor MCP into their development workflow. Every time a developer commits a contract change, their AI agent calls `audit_soroban_contract`, pays 0.15 USDC autonomously, and posts findings as a PR comment — in 20 seconds.

**Result:**
- Cost per audit: **$0.15** vs $20,000–$80,000 → **99.99% cost reduction**
- Time per audit: **~20 seconds** vs 4–8 weeks → **100,000× faster**
- Coverage: **every commit** instead of once at launch → vulnerabilities caught while code is being written, not after funds are drained
- Proven: our test vault contract's 3 vulnerabilities (missing `require_auth`, unchecked arithmetic, unbounded storage) were all detected correctly in a single 20-second run

---

### Scenario 2 — Autonomous Agent Swarm

**Real World Scenario:** A Web3 security DAO deploys a fleet of AI agents that continuously audit competitor and partner protocols for responsible disclosure. They need to audit 200+ contracts per day, 24/7. Paying for each audit manually is impossible — no human can approve 200 microtransactions a day.

**Action:** Each agent calls `audit_soroban_contract_mpp`, pays 0.15 USDC from a shared agent wallet, and files findings to a database. Zero human involvement in the payment loop.

**Result:**
- 200 audits/day × $0.15 = **$30/day** in fully autonomous on-chain spending — every payment traceable, tamper-proof, no chargebacks
- Zero human approvals — machine-to-machine payments at machine speed
- Soroban smart wallet policies cap the agent wallet at a daily budget → **machine-enforced spending limits**, not just soft limits in config
- Every payment is a real Stellar ledger entry: auditable, immutable, exportable for accounting

---

### Scenario 3 — Developer Tool Marketplace

**Real World Scenario:** A developer tools marketplace wants to offer pay-per-use AI tools without user accounts, billing forms, or monthly subscriptions. Traditional monetization requires a Stripe integration, user signup, and credit-based systems — all requiring human interaction to set up.

**Action:** Tools expose x402 endpoints. AI agents (Claude Code, Cursor, Copilot) browse and pay directly — the auditor is listed at 0.15 USDC/call. Agents discover the endpoint, pay, and consume in one automated flow.

**Result:**
- Setup time to monetize a new tool: **one middleware line** in Express → revenue flows immediately
- Setup time for buyers: **zero** — agents pay with a Stellar keypair they already have; no account required
- Payment finality: **3–5 seconds** (Stellar consensus) vs 3–5 business days (bank transfer)
- This revenue model — per-call micropayments at $0.15/call — was previously economically impossible (Stripe fees alone exceed $0.15). Stellar's ~$0.00001/tx fee makes it viable.

---

### Scenario 4 — Security Coverage for Hackathon Ecosystems

**Real World Scenario:** Every Stellar hackathon sees 100+ teams shipping contracts under time pressure. Most skip security review. The Stellar Development Foundation wants to incentivize secure development but can't manually review 100 contracts — there aren't enough auditors.

**Action:** SDF integrates the auditor MCP into the hackathon starter kit. Before submission, Claude Code automatically audits each team's contract, pays 0.15 USDC, and includes the findings report.

**Result:**
- 100 teams × 5 audits each = **500 autonomous Stellar micropayments** over 2 weeks
- Total cost to SDF: **$75 in USDC** to sponsor the wallet — vs $0 budget for manual security review of 100 submissions
- Security coverage: **100% of submissions** → vs ~5% that could afford professional review
- Real Stellar testnet transactions prove the payment protocol operates at hackathon scale

---

## MCP Tools

### `audit_soroban_contract` (x402)
Audits a local `.rs` file via the **x402 protocol**. Pays 0.15 USDC using a signed Stellar auth entry verified by the OpenZeppelin facilitator.

### `audit_soroban_contract_mpp` (Stripe MPP)
Audits a local `.rs` file via the **Stripe Machine Payments Protocol**. Pays 0.15 USDC via Stellar SAC transfer with an HMAC-bound MPP challenge credential.

Both tools return:
```json
{
  "file": "/path/to/contract.rs",
  "protocol": "Stripe MPP / Stellar Testnet",
  "walletAddress": "GDEMO...",
  "model": "llama-3.3-70b-versatile",
  "summary": "CRITICAL: 1 | HIGH: 2",
  "findings": [
    {
      "vulnerability_type": "Missing require_auth",
      "severity": "CRITICAL",
      "confidence": 100,
      "affected_function": "withdraw",
      "cwe_id": "CWE-862",
      "suggested_fix": "Add `to.require_auth();` as the first statement in `fn withdraw()` before any storage reads.",
      "references": ["https://github.com/OpenZeppelin/stellar-contracts/blob/main/docs/sanctifier/S001.md"]
    }
  ]
}
```

---

## Audit Coverage

| Category | Vulnerabilities Detected |
|---|---|
| Authorization | Missing `require_auth()`, cross-contract auth loss, `#[has_role]` without `require_auth()` |
| Arithmetic | Overflow (CWE-190), underflow (CWE-191), division by zero, wrong numeric types |
| Storage | Unbounded Instance storage DoS, key collisions, TTL mismanagement |
| Error Handling | `unwrap()`/`expect()` panics, ignored `Result` values |
| Token Safety | SEP-41 deviations, blocklist bypass, missing burn checks |
| Type Safety | Val storage corruption (GHSA-PM4J-7R4Q-CCG8), unsafe casts |
| Access Control | Upgrade without timelock, single-admin risk |
| Events | Missing SEP-41 events, inconsistent topic counts |
| Cross-Contract | Unvalidated external addresses, ignored sub-call return values |

---

## Tech Stack

| Component | Technology |
|---|---|
| Agent integration | Model Context Protocol (MCP) |
| Payment protocol 1 | x402 (`x402-stellar`, `x402-express`) |
| Payment protocol 2 | Stripe MPP (`@stellar/mpp`, `mppx`) |
| Blockchain | Stellar Testnet |
| Payment asset | USDC (Stellar SAC) |
| Payment facilitator | OpenZeppelin Built-on-Stellar x402 |
| Gateway server | Express.js (TypeScript) |
| AI model | Groq `llama-3.3-70b-versatile` |
| Audit price | 0.15 USDC per contract |
| Audit standard | Sanctifier S001–S012, OpenZeppelin Stellar Contracts |

---

## Quick Start

### 1. Backend

```bash
cd auditor-backend
cp .env.example .env
# Fill in: TESTNET_SERVER_STELLAR_ADDRESS, GROQ_API_KEY, TESTNET_FACILITATOR_API_KEY
npm install
npm run dev
```

### 2. MCP Server

```bash
cd auditor-mcp
cp .env.example .env
# Fill in: STELLAR_SECRET_KEY (funded Stellar testnet keypair with USDC trustline)
npm install
npm run build
```

### 3. Configure Claude Code (or any MCP-compatible agent)

```json
{
  "mcpServers": {
    "auditor-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/auditor-mcp/dist/index.js"],
      "env": {
        "STELLAR_SECRET_KEY": "your-stellar-secret-key",
        "AUDIT_GATEWAY_URL": "http://localhost:3001/api/audit",
        "MPP_AUDIT_GATEWAY_URL": "http://localhost:3001/api/audit/mpp"
      }
    }
  }
}
```

### 4. Run an Audit

In Claude Code or any MCP-compatible agent:

```
Audit /path/to/my_contract.rs for vulnerabilities using the Soroban auditor
```

The agent will automatically pay 0.15 USDC on Stellar Testnet and return findings. No human approves the payment.

---

## Project Structure

```
stellar/
├── auditor-backend/          # Express.js gateway + AI engine
│   ├── src/
│   │   ├── index.ts          # Routes: /api/audit (x402), /api/audit/mpp (MPP)
│   │   ├── auditor.ts        # Two-pass AI audit engine (Groq)
│   │   ├── mpp.ts            # Stellar MPP paywall middleware (mppx)
│   │   └── demo.ts           # Web UI demo endpoint (server-side payment)
│   └── .env.example
│
├── auditor-mcp/              # MCP server (stdio transport)
│   ├── src/
│   │   ├── index.ts          # MCP tools: audit_soroban_contract, audit_soroban_contract_mpp
│   │   └── stellar/          # x402 Stellar client implementation
│   └── .env.example
│
└── test_contract.rs          # Intentionally vulnerable vault contract (for demo)
```

---

## Environment Variables

### auditor-backend/.env

| Variable | Description |
|---|---|
| `TESTNET_SERVER_STELLAR_ADDRESS` | Your Stellar Testnet public key (receives payments) |
| `TESTNET_FACILITATOR_URL` | `https://channels.openzeppelin.com/x402/testnet` |
| `TESTNET_FACILITATOR_API_KEY` | From channels.openzeppelin.com |
| `GROQ_API_KEY` | From console.groq.com/keys (free tier) |
| `GROQ_MODEL` | `llama-3.3-70b-versatile` (default) |
| `DEMO_CLIENT_STELLAR_SECRET` | Demo wallet secret key (server-side payments) |
| `MPP_SECRET_KEY` | Any strong random string — used by mppx to sign MPP challenges |
| `PORT` | `3001` |

### auditor-mcp/.env

| Variable | Description |
|---|---|
| `STELLAR_SECRET_KEY` | Agent wallet secret key (pays for audits) |
| `STELLAR_NETWORK` | `stellar:testnet` |
| `AUDIT_GATEWAY_URL` | `http://localhost:3001/api/audit` |
| `MPP_AUDIT_GATEWAY_URL` | `http://localhost:3001/api/audit/mpp` |

---

## Security Note

The vulnerability detection is AI-powered and intended as a **first-pass screening tool**, not a replacement for a full manual audit on high-value production contracts. Findings with confidence < 50% are suppressed. The full chain-of-thought reasoning is included in the response for review.

---

*Built for Stellar Hacks: Agents — April 2026*
