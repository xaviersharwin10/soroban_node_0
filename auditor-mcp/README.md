# auditor-mcp

MCP server that audits Soroban smart contracts via autonomous on-chain payments on Stellar Testnet. Uses the **x402** and **Stripe MPP** payment protocols — no API keys, no subscriptions, no human approval.

## How it works

1. You ask your AI agent (Claude Code or any MCP-compatible agent) to audit a Soroban `.rs` contract
2. The agent sends the contract to the auditor gateway
3. The gateway returns **HTTP 402 Payment Required**
4. The agent autonomously pays **0.15 USDC on Stellar Testnet** and retries
5. A two-pass AI engine (chain-of-thought + structured output) returns a full security report

No human touches a wallet.

## Quick Start

Add to your MCP config (Claude Code, Cursor, or any MCP client):

```json
{
  "mcpServers": {
    "auditor-mcp": {
      "command": "npx",
      "args": ["-y", "auditor-mcp"],
      "env": {
        "STELLAR_SECRET_KEY": "your-stellar-testnet-secret-key"
      }
    }
  }
}
```

`STELLAR_SECRET_KEY` must be a funded Stellar Testnet keypair with a USDC trustline. Get one free at [Stellar Laboratory](https://laboratory.stellar.org/).

Then in your agent:

```
Audit /path/to/my_contract.rs for vulnerabilities using the Soroban auditor
```

## Tools

### `audit_soroban_contract` (x402)

Audits a Soroban contract via the **x402 protocol** (OpenZeppelin facilitator on Stellar Testnet).

### `audit_soroban_contract_mpp` (Stripe MPP)

Audits a Soroban contract via the **Stripe Machine Payments Protocol** on Stellar Testnet.

Both tools accept:
- A single `.rs` file path
- A directory path — all `.rs` files are discovered recursively and audited together

## Output

```json
{
  "auditId": "a1b2c3d4-...",
  "file": "/path/to/contract.rs",
  "filesAudited": ["/path/to/contract.rs"],
  "protocol": "x402 / Stellar Testnet",
  "walletAddress": "GDEMO...",
  "stellarTxUrl": "https://stellar.expert/explorer/testnet/tx/abc123...",
  "model": "llama-3.3-70b-versatile",
  "summary": "CRITICAL: 1 | HIGH: 2 | MEDIUM: 1",
  "findings": [
    {
      "vulnerability_type": "Missing require_auth",
      "severity": "CRITICAL",
      "confidence": 98,
      "affected_function": "execute",
      "cwe_id": "CWE-862",
      "suggested_fix": "Add `caller.require_auth();` as the first statement in `fn execute()` before any storage reads.",
      "references": ["https://cwe.mitre.org/data/definitions/862.html"]
    }
  ],
  "reasoning": "## Authorization trace\nfn execute(): modifies state and triggers cross-contract call, but has NO require_auth()...",
  "reportFile": "/home/user/.auditor-mcp/reports/a1b2c3d4-....json"
}
```

Every audit is saved to `~/.auditor-mcp/reports/<auditId>.json` with a unique ID for traceability.

## Audit Coverage

| Category | Vulnerabilities Detected |
|---|---|
| Authorization | Missing `require_auth()`, cross-contract auth loss |
| Arithmetic | Overflow (CWE-190), underflow (CWE-191), division by zero |
| Storage | Unbounded Instance storage DoS, TTL mismanagement |
| Error Handling | `unwrap()`/`expect()` panics, ignored `Result` values |
| Token Safety | SEP-41 deviations, missing burn checks |
| Access Control | Upgrade without timelock, single-admin risk |
| Cross-Contract | Unvalidated external addresses, ignored sub-call return values |

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `STELLAR_SECRET_KEY` | Yes | — | Agent wallet secret key (pays for audits) |
| `STELLAR_NETWORK` | No | `stellar:testnet` | Stellar network CAIP-2 ID |
| `AUDIT_GATEWAY_URL` | No | hosted backend | x402 audit endpoint |
| `MPP_AUDIT_GATEWAY_URL` | No | hosted backend | MPP audit endpoint |

## Pricing

**0.15 USDC per audit request** — charged on Stellar Testnet. Stellar transaction fees are ~$0.00001, making true micropayments viable.

## Requirements

- Node.js >= 20
- A funded Stellar Testnet keypair with USDC trustline

## License

MIT
