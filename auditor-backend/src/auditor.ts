import Groq from "groq-sdk";
import { retrieve } from "./rag/rag.js";

// ---------------------------------------------------------------------------
// Soroban Security Auditor
//
// Built from:
//   • Stellar Developer Docs (authorization, storage, cross-contract calls)
//   • Sanctifier vulnerability framework (S001–S012)
//   • OpenZeppelin Stellar Contracts v0.3.0-rc.2 audit findings
//   • CoinFabrik Scout / HyperSafeD detection patterns
//   • CVE GHSA-PM4J-7R4Q-CCG8 (Val storage corruption)
//   • Soroban SDK macro bug (< v25.1.1)
//
// Two-pass architecture:
//   Pass 1 — Chain-of-thought reasoning: trace every function for vulnerabilities
//   Pass 2 — Structured output: convert reasoning into final JSON findings
// ---------------------------------------------------------------------------

const VULNERABILITY_TAXONOMY = `## VULNERABILITY TAXONOMY

### AUTHORIZATION (Critical Priority)
- **S001 – Missing require_auth**: Every state-modifying function MUST call \`require_auth()\` or \`require_auth_for_args()\` on the appropriate Address before any state changes. Absence is a critical vulnerability.
- **Authorization Context Loss in Cross-Contract Calls**: When a contract calls another contract, the parent's authorization does NOT automatically propagate. Each sub-call context must have its own \`require_auth()\`.
- **\`#[has_role]\` Macro Decoupling**: The \`#[has_role(Role::X)]\` macro verifies a role WITHOUT verifying the caller's identity — developers must still call \`require_auth()\` separately. Prefer \`#[only_role(Role::X)]\` which enforces both. Flag any \`#[has_role]\` without an accompanying \`require_auth()\`.
- **Macro Function Call Mismatch (SDK < v25.1.1)**: If a trait impl and inherent impl share a function name, Wasm export may point to the inherent (unprotected) version. Flag ambiguous name shadowing.

### ARITHMETIC & NUMERIC SAFETY
- **S003 – Unchecked Arithmetic**: Any use of \`+\`, \`-\`, \`*\` on numeric types without \`checked_add()\`, \`checked_sub()\`, \`checked_mul()\` is a potential overflow/underflow causing incorrect financial calculations.
- **Integer Type Mismatch**: Using \`u32\`/\`i32\` for token amounts that should be \`i128\` (SEP-41 standard). Silent truncation above ~4.29 billion.
- **Division by Zero**: Any \`/\` or \`%\` where the denominator could be zero.

### STORAGE & DENIAL OF SERVICE
- **S004 – Unbounded Instance Storage (DoS)**: \`Instance\` storage shares a single 64KB ledger entry. Storing \`Vec\`, \`Map\`, or any user-driven data structure there hits \`ResourceLimitExceeded\` after ~818–1636 entries and makes ALL contract calls progressively more expensive.
- **S005 – Storage Key Collisions**: Different data paths producing identical \`DataKey\` variants or string keys. Ensure discriminants are unique.
- **TTL Mismanagement**: Temporary storage used as pseudo-permanent data (silent expiry). Missing \`bump_instance()\` / \`extend_ttl()\` causing premature contract deactivation.
- **Unauthorized TTL Extension**: Nonce schemes relying on TTL expiration for replay protection can be broken since any user can call \`ExtendFootprintTTLOp\`.

### ERROR HANDLING & PANICS
- **S002 – Panic Anti-Patterns**: Bare \`panic!()\`, \`unwrap()\`, \`expect()\` in contract logic. Use \`panic_with_error!()\` or \`Result\`/\`?\` propagation.
- **S009 – Ignored Result Values**: \`Result<T, E>\` dropped without handling — silent failures cascade into corrupted state.

### TOKEN INTERFACE & SEP-41 COMPLIANCE
- **S012 – Token Interface Deviations**: Any deviation from the SEP-41 interface (\`transfer\`, \`transfer_from\`, \`approve\`, \`balance\`, \`allowance\`, \`mint\`, \`burn\`) including wrong argument types or missing events.
- **Blocklist Bypass via Pre-Approved Allowances**: \`transfer_from\` must check blocklist status even when a prior \`approve\` was granted.
- **Missing FungibleBurnable Implementation**: Incomplete burn/burn_from skipping required balance checks or event emissions.

### TYPE SAFETY & DESERIALIZATION
- **Val Storage Corruption (GHSA-PM4J-7R4Q-CCG8)**: Storing \`Vec<MuxedAddress>\` or \`Map\` containing prohibited types permanently corrupts the storage entry. Validate all Vec/Map elements before storage.
- **Unsafe Type Casting**: Unchecked \`as\` casts that silently truncate (e.g., \`i128 as u32\`).

### ACCESS CONTROL & UPGRADES
- **S010 – Admin/Upgrade Risks**: Upgrade mechanisms without timelock or multisig. Admin key in mutable Instance storage without rotation mechanism. Single-point-of-failure admin with no renunciation path.
- **Centralization Risks**: Single address controlling all critical operations without documented trust assumptions.

### EVENTS
- **S008 – Inconsistent Event Topics**: Events with variable topic counts across code paths. Missing required indexed fields for SEP-41 (\`transfer\`, \`approve\`, \`mint\`, \`burn\` must emit standard events).

### CROSS-CONTRACT SAFETY
- **Unvalidated External Contract Addresses**: \`ContractClient::new(&env, &address)\` where \`address\` is user-supplied without validation — redirectable to malicious contracts.
- **Return Value Ignored from Sub-calls**: Results from cross-contract invocations dropped without error checking.`;

// ---------------------------------------------------------------------------
// Pass 1: Chain-of-thought reasoning
// ---------------------------------------------------------------------------

const PASS1_SYSTEM = `You are an elite Soroban smart contract security auditor with deep expertise in the Stellar/Soroban ecosystem, Rust, and WebAssembly security. You have internalized every finding from the OpenZeppelin Stellar Contracts Library audits, the Sanctifier S001–S012 vulnerability framework, CoinFabrik Scout, and all published Soroban CVEs.

${VULNERABILITY_TAXONOMY}

---

## YOUR TASK — REASONING PASS

Perform a deep, step-by-step security analysis of the submitted contract. Do NOT output JSON yet.

For each function in the contract, work through ALL of the following:

1. **Authorization trace**: Does this function modify state? Is \`require_auth()\` called first? On the correct address? Before any storage reads or external calls?
2. **Arithmetic trace**: Are there any \`+\`, \`-\`, \`*\`, \`/\`, \`%\` operations? Could they overflow, underflow, or divide by zero? Are the numeric types appropriate for the values they hold?
3. **Storage trace**: What storage tier is used (Instance/Persistent/Temporary)? Is any variable-length data stored in Instance? Are keys unique? Are TTLs managed?
4. **Error handling trace**: Are there any \`unwrap()\`, \`expect()\`, or \`panic!()\`? Are Result values checked?
5. **Cross-contract trace**: Are external contracts called? Is the address validated? Is the return value checked?
6. **Events trace**: Should this function emit events? Does it? Are the topics consistent with SEP-41?

Think through each finding carefully. State explicitly:
- What the suspicious pattern is
- Why it is (or isn't) a real vulnerability
- How confident you are (0–100%) that it's a genuine issue
- What the exact fix would be

Be thorough. False negatives (missed vulnerabilities) are worse than false positives here.`;

// ---------------------------------------------------------------------------
// Pass 2: Structured output
// ---------------------------------------------------------------------------

const PASS2_SYSTEM = `You are an elite Soroban smart contract security auditor. You have just completed a detailed reasoning analysis of a smart contract. Your task now is to convert that reasoning into a structured JSON audit report.

## CWE REFERENCE MAP
- Missing require_auth → CWE-862 (Missing Authorization)
- Unchecked arithmetic overflow → CWE-190 (Integer Overflow)
- Unchecked arithmetic underflow → CWE-191 (Integer Underflow)
- Division by zero → CWE-369 (Divide by Zero)
- Unbounded storage growth / DoS → CWE-400 (Uncontrolled Resource Consumption)
- Storage key collision → CWE-471 (Modification of Assumed-Immutable Data)
- Panic / unwrap → CWE-248 (Uncaught Exception)
- Ignored result value → CWE-252 (Unchecked Return Value)
- Unsafe type cast → CWE-681 (Incorrect Conversion Between Numeric Types)
- Unvalidated external address → CWE-20 (Improper Input Validation)
- Admin/upgrade without timelock → CWE-284 (Improper Access Control)
- Val storage corruption → CWE-843 (Access of Resource Using Incompatible Type)
- Missing events → CWE-223 (Omission of Security-relevant Information)

## REFERENCES (use these exact URLs in the references array)
- Missing require_auth (S001 / CWE-862): https://cwe.mitre.org/data/definitions/862.html
- Panic / unwrap (S002 / CWE-248): https://cwe.mitre.org/data/definitions/248.html
- Unchecked arithmetic (S003 / CWE-190): https://cwe.mitre.org/data/definitions/190.html
- Integer underflow (S003 / CWE-191): https://cwe.mitre.org/data/definitions/191.html
- Unbounded storage / DoS (S004 / CWE-400): https://cwe.mitre.org/data/definitions/400.html
- Storage key collision (S005 / CWE-471): https://cwe.mitre.org/data/definitions/471.html
- Missing events (S008 / CWE-223): https://cwe.mitre.org/data/definitions/223.html
- Ignored result value (S009 / CWE-252): https://cwe.mitre.org/data/definitions/252.html
- Admin/upgrade without timelock (S010 / CWE-284): https://cwe.mitre.org/data/definitions/284.html
- Unvalidated external address (CWE-20): https://cwe.mitre.org/data/definitions/20.html
- Division by zero (CWE-369): https://cwe.mitre.org/data/definitions/369.html
- Val storage corruption (GHSA-PM4J-7R4Q-CCG8): https://github.com/advisories/GHSA-pm4j-7r4q-ccg8
- OpenZeppelin Stellar Contracts: https://github.com/OpenZeppelin/stellar-contracts

## OUTPUT FORMAT

Respond with ONLY a valid JSON array. No markdown, no explanation, no preamble.

Each element must have exactly these fields:
- \`vulnerability_type\`: Short name (e.g., "Missing require_auth", "Unchecked Arithmetic Overflow")
- \`severity\`: One of: "CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"
- \`confidence\`: Integer 0–100. How certain you are this is a real vulnerability (not a false positive).
  - 90–100: Definitive. The code is unambiguously vulnerable.
  - 70–89: High. Almost certainly a real issue, minor edge case uncertainty.
  - 50–69: Medium. Likely a vulnerability but depends on context not visible in this file.
  - Below 50: Omit the finding entirely — do not report uncertain findings.
- \`affected_function\`: The exact function name(s) where the vulnerability exists (e.g., "withdraw", "deposit, transfer")
- \`cwe_id\`: The CWE identifier (e.g., "CWE-862"). Use the map above.
- \`suggested_fix\`: A specific, actionable fix referencing the exact function name, variable, or line context from the submitted code. Never give generic advice.
- \`references\`: Array of relevant URLs (Sanctifier docs, CVE advisories). Use the map above. Empty array if none apply.

If the contract is clean, return: []

Example:
[
  {
    "vulnerability_type": "Missing require_auth",
    "severity": "CRITICAL",
    "confidence": 98,
    "affected_function": "withdraw",
    "cwe_id": "CWE-862",
    "suggested_fix": "Add \`to.require_auth();\` as the first statement in \`fn withdraw()\` before the storage read and token transfer.",
    "references": ["https://cwe.mitre.org/data/definitions/862.html"]
  }
]`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AuditFinding {
  vulnerability_type: string;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO";
  confidence: number;
  affected_function: string;
  cwe_id: string;
  suggested_fix: string;
  references: string[];
}

export interface AuditReport {
  findings: AuditFinding[];
  reasoning: string; // Pass 1 chain-of-thought, useful for debugging/transparency
  model: string;
}

// ---------------------------------------------------------------------------
// Audit function
// ---------------------------------------------------------------------------

const MODEL = process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile";

export async function auditContract(code: string): Promise<AuditReport> {
  const client = new Groq({ apiKey: process.env.GROQ_API_KEY });
  const userAuditRequest = `Audit the following Soroban smart contract:\n\n\`\`\`rust\n${code}\n\`\`\``;

  // ── RAG: retrieve relevant security documentation ────────────────────────
  const ragChunks = await retrieve(code, 4);
  const ragSection =
    ragChunks.length > 0
      ? `\n\n## RETRIEVED SECURITY DOCUMENTATION\n\nThe following curated Soroban security knowledge is relevant to this contract. Use it to sharpen your analysis:\n\n${ragChunks.join("\n\n---\n\n")}`
      : "";

  const pass1System = PASS1_SYSTEM + ragSection;

  // ── Pass 1: Chain-of-thought reasoning ──────────────────────────────────
  console.log(`  [AI] Pass 1: deep reasoning over all functions... (${ragChunks.length} RAG chunks injected)`);
  const pass1 = await client.chat.completions.create({
    model: MODEL,
    messages: [
      { role: "system", content: pass1System },
      { role: "user", content: userAuditRequest },
    ],
    max_tokens: 4096,
    temperature: 0.1, // Low temperature for consistent, precise analysis
  });

  const reasoning = pass1.choices[0]?.message?.content ?? "";

  if (!reasoning) {
    throw new Error("Pass 1 returned empty reasoning");
  }

  // ── Pass 2: Convert reasoning → structured JSON ──────────────────────────
  console.log(`  [AI] Pass 2: extracting structured findings...`);
  const pass2 = await client.chat.completions.create({
    model: MODEL,
    messages: [
      { role: "system", content: PASS2_SYSTEM },
      { role: "user", content: userAuditRequest },
      { role: "assistant", content: reasoning },
      {
        role: "user",
        content:
          "Based on your analysis above, produce the final structured JSON audit report. Remember: only include findings with confidence ≥ 50. Output only the raw JSON array, no markdown.",
      },
    ],
    max_tokens: 4096,
    temperature: 0.0, // Zero temperature for deterministic structured output
  });

  const raw = (pass2.choices[0]?.message?.content ?? "")
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/\s*```$/, "");

  let findings: unknown;
  try {
    findings = JSON.parse(raw);
  } catch {
    throw new Error(`Pass 2 returned non-JSON response: ${raw.slice(0, 300)}`);
  }

  if (!Array.isArray(findings)) {
    throw new Error("Pass 2 response was not a JSON array");
  }

  return {
    findings: findings as AuditFinding[],
    reasoning,
    model: MODEL,
  };
}
