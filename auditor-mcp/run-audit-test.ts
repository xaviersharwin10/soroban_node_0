import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { wrapFetchWithPayment, x402Client, x402HTTPClient } from "@x402/fetch";
import { STELLAR_TESTNET_CAIP2 } from "./src/stellar/constants.js";
import { ExactStellarScheme } from "./src/stellar/exact/client/scheme.js";
import { createEd25519Signer } from "./src/stellar/signer.js";

loadEnv({ path: resolve(".", ".env") });

const signer = createEd25519Signer(process.env.STELLAR_SECRET_KEY!, STELLAR_TESTNET_CAIP2);
const paymentClient = new x402Client().register("stellar:*", new ExactStellarScheme(signer));
const httpClient = new x402HTTPClient(paymentClient);
const fetchWithPayment = wrapFetchWithPayment(fetch, httpClient);

console.log("Wallet:", signer.address);
console.log("Reading test_contract.rs...");

const code = await readFile("/home/sharwin/stellar/test_contract.rs", "utf8");

console.log("Submitting audit (x402 payment will fire on 402)...\n");

const response = await fetchWithPayment("http://localhost:3001/api/audit", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ code }),
});

const result = await response.json();
console.log("HTTP status:", response.status);
console.log("\n=== AUDIT RESULTS ===\n");
console.log(JSON.stringify(result, null, 2));
