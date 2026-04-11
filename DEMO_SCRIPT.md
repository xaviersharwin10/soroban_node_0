# Demo Script — Soroban Security Auditor
# Stellar Hacks: Agents — April 2026
# Target length: 3 minutes

---

## PRE-RECORDING CHECKLIST

- [ ] Backend warmed up — hit the Render URL once so there's no cold start
- [ ] Claude Code open with auditor-mcp configured in .mcp.json
- [ ] Two windows ready: Claude Code (left) + backend terminal/logs (right) — split screen
- [ ] `contracts/dao_governance.rs` open in VS Code, visible in background
- [ ] `contracts/defi_lending.rs` ready for the MPP demo
- [ ] stellar.expert open in a browser tab (testnet explorer)
- [ ] Font size bumped up — readable on a small video thumbnail
- [ ] Microphone tested — no background noise
- [ ] Screen resolution: 1920x1080, no desktop clutter

---

## [0:00 – 0:18] THE HOOK

**SCREEN:** VS Code showing `dao_governance.rs` — real Rust code fills the screen.
No intro slide. Start directly on the code.

**SAY:**
> "This is a Soroban smart contract — a DAO governance system that controls on-chain voting
> and treasury execution. A professional security audit for this typically costs twenty thousand
> dollars and takes six weeks.
>
> I'm going to audit it right now, for fifteen cents, with an AI agent that pays for itself —
> completely autonomously, on the Stellar network."

---

## [0:18 – 0:32] THE PROBLEM (one breath)

**SCREEN:** Stay on the contract. Scroll slowly — let judges see it's real code.

**SAY:**
> "The problem is that AI agents can't pay for things. Every API on the internet was built for
> humans — subscriptions, API keys, dashboards. But agents need to discover a service, pay for
> it instantly, and continue — at machine speed, with no human in the loop.
>
> That's exactly what x402 and Stripe MPP on Stellar unlock. Let me show you."

---

## [0:32 – 0:48] ARCHITECTURE (quick visual)

**SCREEN:** Switch to a simple 3-box diagram slide:

```
  [Claude Code / MCP Agent]
           |
           |  POST /api/audit
           ▼
  [Auditor Gateway — Express.js]
           |
     HTTP 402 returned
           |
     Agent pays 0.15 USDC
     on Stellar Testnet
           |
     Payment verified on-chain
           |
           ▼
  [Two-Pass AI Engine — Groq]
    Pass 1: Chain-of-thought reasoning
    Pass 2: Structured JSON findings
```

**SAY:**
> "Here's the full system. The MCP agent sends the contract to our gateway.
> The gateway returns HTTP 402 — payment required.
> The agent autonomously signs a Stellar transaction, pays 0.15 USDC, and retries.
> Once payment is verified on-chain, the backend runs a local RAG retrieval step —
> it embeds the contract code and finds the most relevant security docs from our
> curated Soroban knowledge base, using a model that runs entirely on the server,
> no API key needed. Those chunks are injected into a two-pass AI audit engine:
> first a deep reasoning pass, then structured findings with CWE IDs and exact fixes.
> No human approves anything."

---

## [0:48 – 1:50] LIVE DEMO — x402 Flow (THE MONEY SHOT)

**SCREEN:** Split screen.
- LEFT: Claude Code conversation
- RIGHT: Backend terminal showing live logs

**TYPE in Claude Code:**
```
Use audit_soroban_contract to audit /home/sharwin/stellar/contracts/dao_governance.rs
```

**[While it sends the request — narrate the backend log]**

> "The agent is sending the contract to our gateway..."

*[Backend log: `POST /api/audit` appears]*

> "And there it is — the gateway returned HTTP 402, Payment Required. The agent didn't
> fail. It didn't ask me for help. It read the payment requirements directly from the
> 402 response: 0.15 USDC, Stellar Testnet, OpenZeppelin facilitator."

*[Backend log: `Payment verified` or `Settlement confirmed` appears]*

> "Payment confirmed on-chain. The x402 facilitator verified the Stellar transaction,
> and now the contract is being forwarded to the AI audit engine."

**[~10 seconds of AI running — narrate the two-pass engine]**

> "This is a two-pass AI system. Pass one is pure chain-of-thought — the model traces
> every function: authorization, arithmetic, storage, cross-contract calls. It reasons
> out loud before committing to any finding. Pass two converts that reasoning into
> structured output: CWE IDs, severity levels, exact code fixes."

**[Result appears in Claude Code — zoom in on the output]**

> "Done. Let's look at what it found."

**SCROLL through the output — pause on key fields:**

- Pause on `"summary": "CRITICAL: 1 | HIGH: 1 | MEDIUM: 2"` — read it aloud
- Pause on the CRITICAL finding:
  > "Critical finding: execute() has no authorization check. Any account can trigger
  > execution of any passed governance proposal — and drain the treasury. CWE-862.
  > The exact fix is right here."
- Quickly show `reasoning` field — just a glimpse of the chain-of-thought text
  > "And this is the full reasoning trace — every step the AI took to find it.
  > Not a black box. Full audit trail."

**CLICK the `stellarTxUrl` — switch to stellar.expert in browser**

> "And here — this is the actual on-chain Stellar transaction. 0.15 USDC.
> Paid by the agent. Timestamped. Immutable. Verifiable by anyone right now."

*(Let that sit for 3 seconds — it's powerful)*

---

## [1:50 – 2:05] SHOW THE AUDIT ID

**SCREEN:** Back to Claude Code output — zoom in on `auditId` and `filesAudited`

**SAY:**
> "Every audit gets a unique ID. If you audited a full directory, every file is listed
> in filesAudited — the whole project gets one payment, one report, one on-chain receipt."

---

## [2:05 – 2:40] STRIPE MPP DEMO — The Differentiator

**SCREEN:** Claude Code, ready for a new command.

**SAY:**
> "Now the exact same flow — but with Stripe's Machine Payments Protocol, MPP,
> which launched just three weeks ago. This is the second protocol this hackathon
> is built around. We support both."

**TYPE:**
```
Use audit_soroban_contract_mpp to audit /home/sharwin/stellar/contracts/defi_lending.rs
```

**[While it runs — narrate]**

> "Same HTTP 402 handshake. But now using Stripe's open standard — an HMAC-bound
> payment credential verified by the mppx server middleware. The agent pays via
> Stellar SAC transfer, the server verifies the MPP receipt, and the audit runs."

**[Result appears — zoom in on `protocol` field]**

> "Protocol: Stripe MPP / Stellar Testnet. Different payment standard, same
> autonomous flow, same structured output, same on-chain receipt."

**SHOW the `stellarTxUrl` for this one too**

> "Two protocols. One agent. Zero human approvals.
> Both generate real, verifiable Stellar transactions."

---

## [2:40 – 2:55] THE BIGGER PICTURE

**SCREEN:** Simple slide:

```
  Any agent.  Any Soroban contract.
  $0.15.  20 seconds.  No human in the loop.

  npm install -g auditor-mcp
```

**SAY:**
> "This is the first wave of the machine economy — agents discovering services,
> paying for them, and completing tasks end to end. We built the infrastructure
> for that on Stellar.
>
> The auditor-mcp package is live on npm right now. Any MCP-compatible agent —
> Claude Code, Cursor, any client — can point at a Soroban contract and get a
> paid AI security audit with a single command and a funded Stellar keypair.
>
> For DeFi developers: $0.15 per audit versus $20,000 for a firm. Run it on
> every commit, not just at launch."

---

## [2:55 – 3:00] CLOSE

**SCREEN:** Show GitHub repo URL + `auditor-mcp` on npmjs.com

**SAY:**
> "Open source. Real transactions. Both protocols. Built on Stellar."

*(Hard cut. No outro music needed.)*

---

## RECORDING NOTES

**The 402 moment is everything.**
This is the 5 seconds that proves the whole concept. Make sure backend logs are
visible showing the 402 response before the payment goes through. If running locally,
split-screen the backend terminal. If using Render, print the key log lines to console
so they're visible.

**Don't skip the stellar.expert click.**
Showing a real on-chain transaction for 5 seconds is worth more than any slide.
Judges need to see proof it's not mocked.

**The reasoning field is your secret weapon.**
Most teams will show a JSON blob with findings. Scroll past the `reasoning` field
briefly — judges interested in the AI side will lean forward. You don't need to read
it, just let them see it's there.

**Dead air during AI processing (~15s) = narration time.**
Don't rush or cut it. That wait is where you explain the two-pass engine.
It makes the product feel more real, not slower.

**Edit in post.**
Record naturally (will run ~3:30). Cut the loading pauses to 3-4 seconds each in
editing. Tools: Descript, ScreenFlow, or iMovie all work fine.

**Warm the backend before recording.**
Render free tier cold starts take 20-30 seconds. Hit the URL manually 2 minutes
before you start recording.
