# Soroban Security Auditor

**Pay-per-audit AI security analysis for Soroban smart contracts — powered by x402 on Stellar Testnet.**

Built for the [Stellar Hacks: Agents](https://dorahacks.io/hackathon/stellar-agents-x402-stripe-mpp/detail) hackathon.

---

## What It Does

Submit a Soroban `.rs` smart contract and receive a structured vulnerability report in seconds. Payment is settled on-chain (0.15 USDC **or** 1 XLM — no trustline needed for XLM) before the audit runs.

Detected vulnerability classes: S001–S012 (Sanctifier), OpenZeppelin Stellar Contracts audit findings, CoinFabrik Scout patterns, and all published Soroban CVEs.

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│  Web UI  (React + Vite)                                   │
│  • USDC / XLM payment toggle                             │
│  • Animated payment flow stepper                         │
│  • Color-coded findings with CWE IDs + Sanctifier refs   │
└────────────────────┬─────────────────────────────────────┘
                     │ POST /api/audit/demo
                     ▼
┌──────────────────────────────────────────────────────────┐
│  Gateway  (Express.js + x402-stellar)                    │
│  • /api/audit  — x402 paywall, USDC, fee-sponsored       │
│  • /api/audit/demo — server-side payment (USDC or XLM)   │
│  • OpenZeppelin facilitator (zero gas for users)         │
└────────────────────┬─────────────────────────────────────┘
                     │
                     ▼
┌──────────────────────────────────────────────────────────┐
│  AI Audit Engine  (Groq — llama-3.3-70b-versatile)       │
│  Pass 1: Chain-of-thought reasoning                      │
│  Pass 2: Structured JSON findings                        │
└──────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────┐
│  MCP Client  (x402-mcp-stellar)                          │
│  • audit_soroban_contract tool for Claude / agents       │
│  • Full x402 payment flow: 402 → pay USDC → retry        │
└──────────────────────────────────────────────────────────┘
```

---

## Payment Options

| Asset | Amount | Mechanism | Trustline |
|-------|--------|-----------|-----------|
| USDC  | 0.15   | Soroban SAC transfer | Required |
| XLM   | 1      | Classic Payment op   | Not needed |

Both settle on-chain on **Stellar Testnet** before the audit runs.

---

## Finding Report Format

Each finding includes:

- **Severity**: CRITICAL / HIGH / MEDIUM / LOW / INFO
- **Confidence**: 0–100 (findings below 50% are suppressed)
- **CWE ID**: e.g., CWE-862 (Missing Authorization)
- **Affected function**: exact function name from the contract
- **Suggested fix**: specific, actionable — references the actual code
- **References**: Sanctifier docs (S001–S012), CVE advisories

---

## Repo Structure

```
stellar/
├── auditor-backend/   # Express.js gateway + AI audit engine
│   └── src/
│       ├── index.ts   # x402 paywall + /api/audit/demo route
│       ├── auditor.ts # Two-pass Groq LLM audit (S001–S012)
│       └── demo.ts    # Server-side USDC + XLM payments
├── auditor-mcp/       # MCP server — audit_soroban_contract tool
│   └── src/
│       ├── index.ts   # MCP tool definition
│       └── stellar/   # x402 ExactStellarScheme client
├── auditor-web/       # React + Vite + Tailwind web UI
│   └── src/
│       ├── App.tsx
│       ├── api.ts
│       ├── types.ts
│       └── components/
├── test_contract.rs   # Intentionally vulnerable contract for testing
└── CLAUDE.md
```

---

## Running Locally

### Backend

```bash
cd auditor-backend
cp .env.example .env
# fill in TESTNET_SERVER_STELLAR_ADDRESS, GROQ_API_KEY, etc.
npm install
npm run dev
```

### Web UI

```bash
cd auditor-web
npm install
npm run dev
# open http://localhost:5173
```

### MCP Client (Claude Desktop / Claude Code)

```bash
cd auditor-mcp
cp .env.example .env
# fill in STELLAR_SECRET_KEY and AUDIT_GATEWAY_URL
npm install
```

Add to your MCP config:
```json
{
  "mcpServers": {
    "soroban-auditor": {
      "command": "npx",
      "args": ["tsx", "/path/to/auditor-mcp/src/index.ts"]
    }
  }
}
```

Then in Claude: `audit_soroban_contract` tool is available.

---

## Environment Variables

### auditor-backend/.env

| Variable | Description |
|----------|-------------|
| `TESTNET_SERVER_STELLAR_ADDRESS` | Your Stellar Testnet public key (receives payments) |
| `TESTNET_FACILITATOR_URL` | `https://channels.openzeppelin.com/x402/testnet` |
| `TESTNET_FACILITATOR_API_KEY` | From channels.openzeppelin.com |
| `GROQ_API_KEY` | From console.groq.com/keys (free tier) |
| `GROQ_MODEL` | `llama-3.3-70b-versatile` (default) |
| `DEMO_CLIENT_STELLAR_SECRET` | Demo wallet secret key (pays during web UI demo) |
| `PORT` | `3001` |

### auditor-mcp/.env

| Variable | Description |
|----------|-------------|
| `STELLAR_SECRET_KEY` | Client wallet secret key |
| `STELLAR_NETWORK` | `stellar:testnet` |
| `AUDIT_GATEWAY_URL` | Backend URL, e.g., `http://localhost:3001/api/audit` |

---

## Security Note

The vulnerability detection is AI-powered and intended as a **first-pass screening tool**, not a replacement for a full manual audit on high-value production contracts. Findings with confidence < 50% are suppressed. Always review the reasoning trace for context.

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Payment protocol | x402 (HTTP 402 flow) |
| Stellar SDK | `@stellar/stellar-sdk` v15 |
| x402 integration | `x402-stellar`, `x402-express` |
| AI model | Groq — `llama-3.3-70b-versatile` |
| Gateway | Express.js |
| Web UI | React + Vite + Tailwind CSS |
| MCP | `@modelcontextprotocol/sdk` |
| Network | Stellar Testnet |
| Fee sponsorship | OpenZeppelin Built-on-Stellar facilitator |
