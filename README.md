# Soroban Security Auditor — AI Agent with Autonomous On-Chain Payments

> A production-grade AI agent that audits Soroban smart contracts and pays for every audit autonomously — no subscriptions, no API keys, no human approval. Built on Stellar's x402 and Stripe MPP payment protocols.

Built for **[Stellar Hacks: Agents](https://dorahacks.io/hackathon/stellar-agents-x402-stripe-mpp/detail)** — April 2026.

---

## What It Does

An AI agent (Claude Code, or any MCP-compatible agent) reads your Soroban `.rs` contract, pays **0.15 USDC on Stellar Testnet** in a single autonomous transaction, and returns a structured security report with CWE IDs, severity levels, and exact code fixes — all without a human touching a wallet.

---

## Architecture

![Architecture Diagram](docs/architecture.svg)

---

## Sequence Diagrams

### x402 Payment Flow

![x402 Sequence Diagram](docs/sequence_x402.svg)

### Stripe MPP Flow

![Stripe MPP Sequence Diagram](docs/sequence_mpp.svg)

---

## Value Propositions

| User Persona | Real-World Scenario | Quantifiable Impact |
|---|---|---|
| DeFi developer | Needs a security audit before launching a Soroban lending protocol. Traditional firms charge $20k–$80k and take 4–8 weeks. | **$0.15/audit** vs $20k+ — 99.99% cost reduction. **~20 seconds** vs 4–8 weeks — 100,000× faster. Run on every commit, not just at launch. |
| Autonomous agent fleet | A security DAO runs 200+ contract audits per day with no human in the loop. Manual payment approval is impossible at that scale. | **$30/day** in fully autonomous on-chain spending. Zero human approvals. Every payment is a traceable, immutable Stellar ledger entry. |
| Dev tool builder | Wants per-call monetization without user accounts, billing setup, or subscriptions. Stripe fees alone exceed $0.15/call. | Stellar's ~$0.00001/tx fee makes $0.15 micropayments viable. **One middleware line** to monetize. Buyers need only a Stellar keypair — no signup. |
| Hackathon organizer | 100+ teams ship contracts under time pressure; most skip security review. Not enough auditors to cover all submissions manually. | **100% audit coverage** for $75 in USDC — vs $0 budget for manual review of 100 submissions. Real on-chain transactions prove the protocol at scale. |

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
