import "dotenv/config";
import express from "express";
import cors from "cors";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactStellarScheme } from "@x402/stellar/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { Transaction, Networks } from "@stellar/stellar-sdk";
import { auditContract } from "./auditor.js";
import { buildIndex } from "./rag/rag.js";
import { demoAudit, type PaymentAsset } from "./demo.js";
import { mppAuditPaywall } from "./mpp.js";

// ---------------------------------------------------------------------------
// Extract Stellar transaction hash from x402 or MPP payment headers
// ---------------------------------------------------------------------------

function extractStellarTxUrl(req: express.Request, protocol: "x402" | "mpp"): string | null {
  try {
    if (protocol === "x402") {
      // x402 v2 uses PAYMENT-SIGNATURE header; v1 uses X-PAYMENT
      const raw = (req.headers["payment-signature"] || req.headers["x-payment"]) as string | undefined;
      if (!raw) return null;
      let parsed: any;
      try { parsed = JSON.parse(raw); } catch {
        try { parsed = JSON.parse(Buffer.from(raw, "base64").toString("utf8")); } catch { return null; }
      }
      const xdr = parsed?.payload?.transaction;
      if (!xdr) return null;
      const tx = new Transaction(xdr, Networks.TESTNET);
      const hash = tx.hash().toString("hex");
      return `https://stellar.expert/explorer/testnet/tx/${hash}`;
    }

    if (protocol === "mpp") {
      // Authorization header: "mpp <base64-encoded credential JSON>"
      const auth = req.headers["authorization"] as string | undefined;
      if (!auth) return null;
      const token = auth.replace(/^mpp\s+/i, "").replace(/^Bearer\s+/i, "").trim();
      let parsed: any;
      try { parsed = JSON.parse(token); } catch {
        try { parsed = JSON.parse(Buffer.from(token, "base64").toString("utf8")); } catch { return null; }
      }
      // Push-mode: payload.hash IS the Stellar tx hash
      const hash = parsed?.payload?.hash ?? parsed?.hash;
      if (hash) return `https://stellar.expert/explorer/testnet/tx/${hash}`;
      // Pull-mode: payload.transaction is XDR
      const xdr = parsed?.payload?.transaction ?? parsed?.transaction;
      if (xdr) {
        const tx = new Transaction(xdr, Networks.TESTNET);
        return `https://stellar.expert/explorer/testnet/tx/${tx.hash().toString("hex")}`;
      }
      return null;
    }
  } catch {
    return null;
  }
  return null;
}

const PORT = process.env.PORT ?? "3001";
const STELLAR_ADDRESS = process.env.TESTNET_SERVER_STELLAR_ADDRESS ?? "";
const FACILITATOR_URL = process.env.TESTNET_FACILITATOR_URL ?? "";
const FACILITATOR_API_KEY = process.env.TESTNET_FACILITATOR_API_KEY ?? "";
const AUDIT_PRICE = "0.15"; // USDC

if (!STELLAR_ADDRESS) {
  console.error("Missing TESTNET_SERVER_STELLAR_ADDRESS in .env");
  process.exit(1);
}
if (!FACILITATOR_URL) {
  console.error("Missing TESTNET_FACILITATOR_URL in .env");
  process.exit(1);
}

// --- x402 payment infrastructure ---

const facilitatorClient = new HTTPFacilitatorClient({
  url: FACILITATOR_URL,
  ...(FACILITATOR_API_KEY && {
    createAuthHeaders: async () => {
      const headers = { Authorization: `Bearer ${FACILITATOR_API_KEY}` };
      return { verify: headers, settle: headers, supported: headers };
    },
  }),
});

const x402Server = new x402ResourceServer(facilitatorClient).register(
  "stellar:testnet",
  new ExactStellarScheme(),
);

const auditPaywall = paymentMiddleware(
  {
    "POST /api/audit": {
      accepts: [
        {
          scheme: "exact",
          price: AUDIT_PRICE,
          network: "stellar:testnet",
          payTo: STELLAR_ADDRESS,
        },
      ],
      description: `Soroban smart contract security audit — ${AUDIT_PRICE} USDC`,
    },
  },
  x402Server,
);

// --- Express app ---

const app = express();

app.use(cors());
app.use(express.json({ limit: "1mb" }));

// x402 middleware must be registered before the route handler
app.use(auditPaywall);

app.post("/api/audit", async (req, res) => {
  const { code } = req.body as { code?: string };

  if (!code || typeof code !== "string" || code.trim().length === 0) {
    res.status(400).json({ error: "Request body must include a non-empty 'code' field." });
    return;
  }

  // Payment has been verified by x402 middleware at this point.
  // Note: the real on-chain tx hash is returned in the PAYMENT-RESPONSE header by the
  // x402 middleware after settlement — the client extracts it from there, not here.
  try {
    const report = await auditContract(code);
    res.json(report);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Audit error:", message);
    res.status(502).json({ error: "Audit failed", detail: message });
  }
});

// Web UI demo endpoint — payment handled server-side, no x402 header needed
app.post("/api/audit/demo", async (req, res) => {
  const { code, asset = "USDC" } = req.body as { code?: string; asset?: string };
  if (!code || typeof code !== "string" || code.trim().length === 0) {
    res.status(400).json({ error: "Request body must include a non-empty 'code' field." });
    return;
  }
  if (asset !== "USDC" && asset !== "XLM") {
    res.status(400).json({ error: "asset must be 'USDC' or 'XLM'" });
    return;
  }
  try {
    const result = await demoAudit(code, asset as PaymentAsset);
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Demo audit error:", message);
    res.status(502).json({ error: "Demo audit failed", detail: message });
  }
});

// Stellar MPP endpoint — payment gated by @stellar/mpp + mppx
app.post(
  "/api/audit/mpp",
  (req, res, next) => {
    const bytes = Buffer.byteLength(JSON.stringify(req.body), "utf8");
    console.log(`\n→ [MPP] Incoming audit request (${bytes.toLocaleString()} bytes of Rust)`);

    // Intercept the response to log the 402 challenge when it happens
    const origEnd = res.end.bind(res);
    (res as any).end = function (...args: any[]) {
      if (res.statusCode === 402) {
        console.log(`← [MPP] HTTP 402 — payment challenge issued (0.15 USDC, stellar:testnet)`);
        console.log(`   Waiting for client to pay and retry...`);
      }
      return origEnd(...args);
    };

    next();
  },
  mppAuditPaywall,
  async (req, res) => {
    const { code } = req.body as { code?: string };
    if (!code || typeof code !== "string" || code.trim().length === 0) {
      res.status(400).json({ error: "Request body must include a non-empty 'code' field." });
      return;
    }

    console.log(`✓ [MPP] Payment verified — starting security audit...`);
    const start = Date.now();

    try {
      const report = await auditContract(code);
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);

      const counts: Record<string, number> = {};
      for (const f of report.findings) counts[f.severity] = (counts[f.severity] ?? 0) + 1;
      const summary = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"]
        .filter((s) => counts[s])
        .map((s) => `${counts[s]} ${s}`)
        .join(", ");

      const txUrl = extractStellarTxUrl(req, "mpp");
      if (txUrl) console.log(`  [MPP] Stellar tx: ${txUrl}`);
      console.log(
        `✓ [AUDIT] Complete — ${report.findings.length} finding(s)${summary ? `: ${summary}` : " (clean)"} (${elapsed}s)\n`,
      );

      res.json({ ...report, stellarTxUrl: txUrl });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`✗ [AUDIT] Failed: ${message}\n`);
      res.status(502).json({ error: "Audit failed", detail: message });
    }
  },
);

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.listen(Number(PORT), () => {
  console.log(`auditor-backend listening on port ${PORT}`);
  console.log(`  POST /api/audit  →  ${AUDIT_PRICE} USDC (stellar:testnet)`);
  console.log(`  payTo: ${STELLAR_ADDRESS}`);
  console.log(`  facilitator: ${FACILITATOR_URL}`);
  // Build RAG index in background — audit falls back to taxonomy-only if not ready yet
  buildIndex().catch((err) => console.warn("  [RAG] Index build failed (non-fatal):", err));
});
