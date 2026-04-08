import {
  Keypair,
  nativeToScVal,
  TransactionBuilder,
  contract,
  Asset,
  Operation,
  Horizon,
} from "@stellar/stellar-sdk";
import { Api, Server as RpcServer } from "@stellar/stellar-sdk/rpc";
import { auditContract, type AuditReport } from "./auditor.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const USDC_TESTNET_SAC = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
const TESTNET_RPC_URL = "https://soroban-testnet.stellar.org";
const TESTNET_HORIZON_URL = "https://horizon-testnet.stellar.org";
const TESTNET_PASSPHRASE = "Test SDF Network ; September 2015";
const BASE_FEE = 10_000;
// 0.15 USDC — USDC has 7 decimal places on Stellar, so 0.15 = 1_500_000 stroops
const AUDIT_AMOUNT_STROOPS = BigInt(1_500_000);
// 1 XLM per audit (≈ 0.10–0.15 USD on testnet) — no trustline required
const AUDIT_AMOUNT_XLM = "1";

export type PaymentAsset = "USDC" | "XLM";

export interface DemoAuditResult extends AuditReport {
  txHash: string;
  explorerUrl: string;
  asset: PaymentAsset;
}

// ---------------------------------------------------------------------------
// USDC payment via Soroban SAC transfer — server-side for web demo
// ---------------------------------------------------------------------------

async function demoPay(): Promise<{ txHash: string; explorerUrl: string }> {
  const secret = process.env.DEMO_CLIENT_STELLAR_SECRET;
  if (!secret) throw new Error("DEMO_CLIENT_STELLAR_SECRET not set in .env");

  const toAddress = process.env.TESTNET_SERVER_STELLAR_ADDRESS;
  if (!toAddress) throw new Error("TESTNET_SERVER_STELLAR_ADDRESS not set in .env");

  const kp = Keypair.fromSecret(secret);
  const fromAddress = kp.publicKey();

  // Step 1: Build + simulate the USDC transfer transaction
  // publicKey sets the source account so sequence numbers are correct for self-submission
  const tx = await contract.AssembledTransaction.build({
    contractId: USDC_TESTNET_SAC,
    method: "transfer",
    args: [
      nativeToScVal(fromAddress, { type: "address" }),
      nativeToScVal(toAddress, { type: "address" }),
      nativeToScVal(AUDIT_AMOUNT_STROOPS, { type: "i128" }),
    ],
    networkPassphrase: TESTNET_PASSPHRASE,
    rpcUrl: TESTNET_RPC_URL,
    publicKey: fromAddress,
    parseResultXdr: (result) => result,
  });

  if (!tx.simulation || !Api.isSimulationSuccess(tx.simulation)) {
    throw new Error(`Simulation failed: ${JSON.stringify(tx.simulation)}`);
  }

  // When fromAddress == publicKey (the invoker), Soroban handles auth implicitly —
  // no signAuthEntries needed. We go straight to building the final transaction.

  // Step 2: Build the final transaction with accurate fee + Soroban resource data
  const finalTx = TransactionBuilder.cloneFrom(tx.built!, {
    fee: (BASE_FEE + parseInt(tx.simulation.minResourceFee, 10)).toString(),
    sorobanData: tx.simulationData.transactionData,
    networkPassphrase: TESTNET_PASSPHRASE,
  }).build();

  // Step 3: Sign the transaction envelope (this wallet pays its own fees)
  finalTx.sign(kp);

  // Step 4: Submit to Stellar Testnet
  const rpcServer = new RpcServer(TESTNET_RPC_URL);
  const sent = await rpcServer.sendTransaction(finalTx);

  if (sent.status === "ERROR") {
    throw new Error(`Transaction rejected: ${JSON.stringify(sent.errorResult)}`);
  }

  // Step 5: Poll for on-chain confirmation
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const status = await rpcServer.getTransaction(sent.hash);
    if (status.status === "SUCCESS") {
      return {
        txHash: sent.hash,
        explorerUrl: `https://stellar.expert/explorer/testnet/tx/${sent.hash}`,
      };
    }
    if (status.status === "FAILED") {
      throw new Error(`On-chain transaction failed: ${JSON.stringify(status)}`);
    }
    // status === "NOT_FOUND" means still pending — keep polling
  }

  throw new Error("Transaction confirmation timeout after 40 seconds");
}

// ---------------------------------------------------------------------------
// XLM payment via classic Stellar Payment operation — no trustline required
// ---------------------------------------------------------------------------

async function demoPayXLM(): Promise<{ txHash: string; explorerUrl: string }> {
  const secret = process.env.DEMO_CLIENT_STELLAR_SECRET;
  if (!secret) throw new Error("DEMO_CLIENT_STELLAR_SECRET not set in .env");

  const toAddress = process.env.TESTNET_SERVER_STELLAR_ADDRESS;
  if (!toAddress) throw new Error("TESTNET_SERVER_STELLAR_ADDRESS not set in .env");

  const kp = Keypair.fromSecret(secret);
  const horizon = new Horizon.Server(TESTNET_HORIZON_URL);

  // Load account to get current sequence number
  const account = await horizon.loadAccount(kp.publicKey());

  // Build a classic Payment operation — XLM is native, no SAC needed
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE.toString(),
    networkPassphrase: TESTNET_PASSPHRASE,
  })
    .addOperation(
      Operation.payment({
        destination: toAddress,
        asset: Asset.native(),
        amount: AUDIT_AMOUNT_XLM,
      }),
    )
    .setTimeout(30)
    .build();

  tx.sign(kp);

  // Submit via Horizon (classic path — no Soroban RPC needed)
  const result = await horizon.submitTransaction(tx);

  return {
    txHash: result.hash,
    explorerUrl: `https://stellar.expert/explorer/testnet/tx/${result.hash}`,
  };
}

// ---------------------------------------------------------------------------
// Public: run payment + audit in parallel (faster overall)
// ---------------------------------------------------------------------------

export async function demoAudit(
  code: string,
  asset: PaymentAsset = "USDC",
): Promise<DemoAuditResult> {
  const [payment, audit] = await Promise.all([
    asset === "XLM" ? demoPayXLM() : demoPay(),
    auditContract(code),
  ]);
  return { ...audit, ...payment, asset };
}
