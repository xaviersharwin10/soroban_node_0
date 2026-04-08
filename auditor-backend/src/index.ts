import "dotenv/config";
import express from "express";
import cors from "cors";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactStellarScheme } from "@x402/stellar/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { auditContract } from "./auditor.js";
import { demoAudit, type PaymentAsset } from "./demo.js";

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

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.listen(Number(PORT), () => {
  console.log(`auditor-backend listening on port ${PORT}`);
  console.log(`  POST /api/audit  →  ${AUDIT_PRICE} USDC (stellar:testnet)`);
  console.log(`  payTo: ${STELLAR_ADDRESS}`);
  console.log(`  facilitator: ${FACILITATOR_URL}`);
});
