import { config as loadEnv } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { wrapFetchWithPayment, x402Client, x402HTTPClient, decodePaymentResponseHeader } from "@x402/fetch";
import { Mppx as MppxClient } from "mppx/client";
import { stellar as stellarMpp } from "@stellar/mpp/charge/client";
import { z } from "zod";

import { STELLAR_TESTNET_CAIP2, STELLAR_PUBNET_CAIP2 } from "./stellar/constants";
import { ExactStellarScheme } from "./stellar/exact/client/scheme";
import { createEd25519Signer } from "./stellar/signer";

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

const currentDir = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(currentDir, "..", ".env") });

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

const STELLAR_SECRET_KEY = requireEnv("STELLAR_SECRET_KEY");
const AUDIT_GATEWAY_URL =
  process.env.AUDIT_GATEWAY_URL?.trim() || "https://soroban-node-0.onrender.com/api/audit";
const MPP_GATEWAY_URL =
  process.env.MPP_AUDIT_GATEWAY_URL?.trim() || "https://soroban-node-0.onrender.com/api/audit/mpp";

const rawNetwork = (process.env.STELLAR_NETWORK ?? STELLAR_TESTNET_CAIP2).trim();
if (rawNetwork !== STELLAR_TESTNET_CAIP2 && rawNetwork !== STELLAR_PUBNET_CAIP2) {
  throw new Error(`Unsupported STELLAR_NETWORK: ${rawNetwork}`);
}
const STELLAR_NETWORK = rawNetwork as typeof STELLAR_TESTNET_CAIP2 | typeof STELLAR_PUBNET_CAIP2;

// ---------------------------------------------------------------------------
// x402 payment client
// ---------------------------------------------------------------------------

const signer = createEd25519Signer(STELLAR_SECRET_KEY, STELLAR_NETWORK);

const paymentClient = new x402Client().register(
  "stellar:*",
  new ExactStellarScheme(signer),
);

const httpClient = new x402HTTPClient(paymentClient);
const fetchWithPayment = wrapFetchWithPayment(fetch, httpClient);

// ---------------------------------------------------------------------------
// Stellar MPP payment client
// ---------------------------------------------------------------------------

const mppClient = MppxClient.create({
  methods: [stellarMpp.charge({ secretKey: STELLAR_SECRET_KEY })],
  polyfill: false,
});

// ---------------------------------------------------------------------------
// MCP server
// ---------------------------------------------------------------------------

const server = new McpServer({
  name: process.env.MCP_SERVER_NAME || "auditor-mcp",
  version: process.env.MCP_SERVER_VERSION || "0.1.0",
});

server.tool(
  "audit_soroban_contract",
  [
    "Reads a local Soroban smart contract (.rs file) and submits it for a paid security audit.",
    "Charges 0.15 USDC on Stellar Testnet via the x402 protocol.",
    "Returns a structured audit report with vulnerabilities, warnings, and recommendations.",
  ].join(" "),
  {
    file_path: z
      .string()
      .describe("Absolute or relative path to the Soroban .rs contract file to audit"),
  },
  async ({ file_path }) => {
    // 1. Read the contract file
    let code: string;
    try {
      code = await readFile(file_path, "utf8");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: `Failed to read file "${file_path}": ${message}` }],
        isError: true,
      };
    }

    if (code.trim().length === 0) {
      return {
        content: [{ type: "text", text: `File "${file_path}" is empty.` }],
        isError: true,
      };
    }

    // 2. POST to auditor-backend — x402 payment handshake is handled automatically:
    //    - fetchWithPayment sends the initial request
    //    - if the server returns 402, it signs and submits 0.15 USDC on Stellar Testnet
    //    - then retries with the payment receipt header
    let response: Response;
    try {
      response = await fetchWithPayment(AUDIT_GATEWAY_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [
          {
            type: "text",
            text: `Payment or network error calling auditor-backend: ${message}`,
          },
        ],
        isError: true,
      };
    }

    // 3. Extract real on-chain tx hash from PAYMENT-RESPONSE header (set by x402 middleware
    //    after the facilitator submits the transaction to Stellar post-settlement).
    let stellarTxUrl: string | null = null;
    try {
      const paymentResponseHeader = response.headers.get("PAYMENT-RESPONSE");
      if (paymentResponseHeader) {
        const settlement = decodePaymentResponseHeader(paymentResponseHeader);
        if (settlement && typeof (settlement as any).transaction === "string" && (settlement as any).transaction) {
          stellarTxUrl = `https://stellar.expert/explorer/testnet/tx/${(settlement as any).transaction}`;
        }
      }
    } catch { /* ignore — stellarTxUrl stays null */ }

    const rawBody = await response.text();

    if (!response.ok) {
      return {
        content: [
          {
            type: "text",
            text: `Auditor backend returned HTTP ${response.status}:\n${rawBody}`,
          },
        ],
        isError: true,
      };
    }

    // 4. Parse and surface the audit result
    let report: { findings: unknown[]; model?: string; reasoning?: string } | null = null;
    try {
      report = JSON.parse(rawBody);
    } catch {
      return {
        content: [{ type: "text", text: `Audit backend returned non-JSON response:\n${rawBody}` }],
        isError: true,
      };
    }

    const findings = report?.findings ?? [];
    const counts: Record<string, number> = {};
    if (Array.isArray(findings)) {
      for (const f of findings as Array<{ severity: string }>) {
        counts[f.severity] = (counts[f.severity] ?? 0) + 1;
      }
    }

    const summary = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"]
      .filter((s) => counts[s])
      .map((s) => `${s}: ${counts[s]}`)
      .join(" | ");

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              file: file_path,
              protocol: "x402 / Stellar Testnet",
              walletAddress: signer.address,
              stellarTxUrl,
              model: report?.model,
              summary: summary || "No vulnerabilities found",
              findings,
              reasoning: report?.reasoning ?? null,
            },
            null,
            2,
          ),
        },
      ],
    };
  },
);

// ---------------------------------------------------------------------------
// MPP tool — audit_soroban_contract_mpp (Stripe MPP / Stellar)
// ---------------------------------------------------------------------------

server.tool(
  "audit_soroban_contract_mpp",
  [
    "Reads a local Soroban smart contract (.rs file) and submits it for a paid security audit.",
    "Charges 0.15 USDC on Stellar Testnet via the Stripe Machine Payments Protocol (MPP).",
    "Returns a structured audit report with vulnerabilities, CWE IDs, severity levels, and fixes.",
  ].join(" "),
  {
    file_path: z
      .string()
      .describe("Absolute or relative path to the Soroban .rs contract file to audit"),
  },
  async ({ file_path }) => {
    let code: string;
    try {
      code = await readFile(file_path, "utf8");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: `Failed to read file "${file_path}": ${message}` }],
        isError: true,
      };
    }

    if (code.trim().length === 0) {
      return {
        content: [{ type: "text", text: `File "${file_path}" is empty.` }],
        isError: true,
      };
    }

    // mppClient.fetch handles the MPP 402 challenge automatically:
    //   - receives HTTP 402 with Stellar payment challenge
    //   - signs and submits 0.15 USDC SAC transfer on Stellar Testnet
    //   - retries with the payment credential
    let response: Response;
    try {
      response = await mppClient.fetch(MPP_GATEWAY_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [
          {
            type: "text",
            text: `MPP payment or network error: ${message}`,
          },
        ],
        isError: true,
      };
    }

    // Extract real on-chain tx hash from Payment-Receipt header (set by mppx middleware
    // after the Stellar transaction is submitted during settlement).
    // Receipt schema: { method, reference: "<txHash>", status, timestamp }
    let mppStellarTxUrl: string | null = null;
    try {
      const receiptHeader = response.headers.get("Payment-Receipt");
      if (receiptHeader) {
        const json = Buffer.from(receiptHeader, "base64url").toString("utf8");
        const receipt = JSON.parse(json);
        if (receipt?.reference) {
          mppStellarTxUrl = `https://stellar.expert/explorer/testnet/tx/${receipt.reference}`;
        }
      }
    } catch { /* ignore — mppStellarTxUrl stays null */ }

    const rawBody = await response.text();

    if (!response.ok) {
      return {
        content: [
          {
            type: "text",
            text: `Auditor backend returned HTTP ${response.status}:\n${rawBody}`,
          },
        ],
        isError: true,
      };
    }

    let report: { findings: unknown[]; model?: string; reasoning?: string } | null = null;
    try {
      report = JSON.parse(rawBody);
    } catch {
      return {
        content: [{ type: "text", text: `Audit backend returned non-JSON:\n${rawBody}` }],
        isError: true,
      };
    }

    const findings = report?.findings ?? [];
    const counts: Record<string, number> = {};
    if (Array.isArray(findings)) {
      for (const f of findings as Array<{ severity: string }>) {
        counts[f.severity] = (counts[f.severity] ?? 0) + 1;
      }
    }

    const summary = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"]
      .filter((s) => counts[s])
      .map((s) => `${s}: ${counts[s]}`)
      .join(" | ");

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              file: file_path,
              protocol: "Stripe MPP / Stellar Testnet",
              walletAddress: signer.address,
              stellarTxUrl: mppStellarTxUrl,
              model: report?.model,
              summary: summary || "No vulnerabilities found",
              findings,
              reasoning: report?.reasoning ?? null,
            },
            null,
            2,
          ),
        },
      ],
    };
  },
);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

const transport = new StdioServerTransport();
await server.connect(transport);

console.error("auditor-mcp running over stdio");
console.error(`wallet : ${signer.address}`);
console.error(`network: ${STELLAR_NETWORK}`);
console.error(`gateway: ${AUDIT_GATEWAY_URL}`);
