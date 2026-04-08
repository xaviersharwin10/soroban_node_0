import { nativeToScVal, TransactionBuilder, contract } from "@stellar/stellar-sdk";
import { Api } from "@stellar/stellar-sdk/rpc";
import { handleSimulationResult } from "../../shared";
import {
  getEstimatedLedgerCloseTimeSeconds,
  getNetworkPassphrase,
  getRpcClient,
  getRpcUrl,
  isStellarNetwork,
  type RpcConfig,
  validateStellarAssetAddress,
  validateStellarDestinationAddress,
} from "../../utils";
import type { ClientStellarSigner } from "../../signer";
import type { PaymentPayload, PaymentRequirements, SchemeNetworkClient } from "@x402/core/types";

const DEFAULT_BASE_FEE_STROOPS = 10_000;

export class ExactStellarScheme implements SchemeNetworkClient {
  readonly scheme = "exact";

  constructor(
    private readonly signer: ClientStellarSigner,
    private readonly rpcConfig?: RpcConfig,
  ) {}

  async createPaymentPayload(
    x402Version: number,
    paymentRequirements: PaymentRequirements,
  ): Promise<Pick<PaymentPayload, "x402Version" | "payload">> {
    try {
      this.validateInput(paymentRequirements);
    } catch (error) {
      throw new Error(`Invalid input for Stellar payment: ${error}`);
    }

    const { network, payTo, asset, amount, extra, maxTimeoutSeconds } = paymentRequirements;
    const networkPassphrase = getNetworkPassphrase(network);
    const rpcUrl = getRpcUrl(network, this.rpcConfig);

    if (!extra.areFeesSponsored) {
      throw new Error("Exact scheme requires areFeesSponsored to be true");
    }

    const rpcServer = getRpcClient(network, this.rpcConfig);
    const latestLedger = await rpcServer.getLatestLedger();
    const estimatedLedgerSeconds = await getEstimatedLedgerCloseTimeSeconds(rpcServer);
    const maxLedger =
      latestLedger.sequence + Math.ceil(maxTimeoutSeconds / estimatedLedgerSeconds);

    const tx = await contract.AssembledTransaction.build({
      contractId: asset,
      method: "transfer",
      args: [
        nativeToScVal(this.signer.address, { type: "address" }),
        nativeToScVal(payTo, { type: "address" }),
        nativeToScVal(amount, { type: "i128" }),
      ],
      networkPassphrase,
      rpcUrl,
      parseResultXdr: result => result,
    });
    handleSimulationResult(tx.simulation);

    let missingSigners = tx.needsNonInvokerSigningBy();
    if (!missingSigners.includes(this.signer.address) || missingSigners.length > 1) {
      throw new Error(
        `Expected to sign with [${this.signer.address}], got [${missingSigners.join(", ")}]`,
      );
    }

    await tx.signAuthEntries({
      address: this.signer.address,
      signAuthEntry: this.signer.signAuthEntry,
      expiration: maxLedger,
    });

    await tx.simulate();
    handleSimulationResult(tx.simulation);

    missingSigners = tx.needsNonInvokerSigningBy();
    if (missingSigners.length > 0) {
      throw new Error(`Unexpected signer(s) still required: [${missingSigners.join(", ")}]`);
    }

    const finalTx =
      tx.simulation && Api.isSimulationSuccess(tx.simulation)
        ? TransactionBuilder.cloneFrom(tx.built!, {
            fee: (DEFAULT_BASE_FEE_STROOPS + parseInt(tx.simulation.minResourceFee, 10)).toString(),
            sorobanData: tx.simulationData.transactionData,
            networkPassphrase,
          }).build()
        : tx.built!;

    return {
      x402Version,
      payload: { transaction: finalTx.toXDR() },
    };
  }

  private validateInput(req: PaymentRequirements): void {
    const { scheme, network, payTo, asset, amount } = req;
    if (typeof amount !== "string" || !Number.isInteger(Number(amount)) || Number(amount) <= 0) {
      throw new Error(`Invalid amount: ${amount}`);
    }
    if (scheme !== "exact") throw new Error(`Unsupported scheme: ${scheme}`);
    if (!isStellarNetwork(network)) throw new Error(`Unsupported network: ${network}`);
    if (!validateStellarDestinationAddress(payTo)) throw new Error(`Invalid payTo: ${payTo}`);
    if (!validateStellarAssetAddress(asset)) throw new Error(`Invalid asset: ${asset}`);
  }
}
