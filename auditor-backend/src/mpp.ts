import "dotenv/config";
import { Mppx } from "mppx/express";
import { stellar } from "@stellar/mpp/charge/server";
import { USDC_SAC_TESTNET, STELLAR_TESTNET } from "@stellar/mpp";

const STELLAR_ADDRESS = process.env.TESTNET_SERVER_STELLAR_ADDRESS ?? "";
const MPP_SECRET_KEY = process.env.MPP_SECRET_KEY ?? "stellar-auditor-mpp-secret-2026";

const mppx = Mppx.create({
  secretKey: MPP_SECRET_KEY,
  methods: [
    stellar({
      recipient: STELLAR_ADDRESS,
      currency: USDC_SAC_TESTNET,
      network: STELLAR_TESTNET,
      decimals: 7,
    }),
  ],
});

// Express middleware — returns HTTP 402 if unpaid, attaches Payment-Receipt on success
export const mppAuditPaywall = mppx.charge({
  amount: "0.15",
  description: "Soroban smart contract security audit - 0.15 USDC via Stellar MPP",
});
