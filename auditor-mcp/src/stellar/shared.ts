import { Transaction, Address, Operation, xdr } from "@stellar/stellar-sdk";
import { Api, assembleTransaction } from "@stellar/stellar-sdk/rpc";

export function handleSimulationResult(simulation?: Api.SimulateTransactionResponse) {
  if (!simulation) throw new Error("Simulation result is undefined");
  if (Api.isSimulationRestore(simulation)) {
    throw new Error(`Stellar simulation result has type "RESTORE"`);
  }
  if (Api.isSimulationError(simulation)) {
    throw new Error(`Stellar simulation failed${simulation.error ? `: ${simulation.error}` : ""}`);
  }
}

export type ContractSigners = {
  alreadySigned: string[];
  pendingSignature: string[];
};

export function gatherAuthEntrySignatureStatus({
  transaction,
  simulationResponse,
  simulate,
}: {
  transaction: Transaction;
  simulationResponse?: Api.SimulateTransactionResponse;
  simulate?: boolean;
}): ContractSigners {
  const shouldAssemble = simulate ?? simulationResponse !== undefined;
  let assembledTx = transaction;
  if (shouldAssemble && simulationResponse) {
    assembledTx = assembleTransaction(transaction, simulationResponse).build();
  }

  if (assembledTx.operations.length !== 1) {
    throw new Error(`Expected 1 operation, got ${assembledTx.operations.length}`);
  }
  const op = assembledTx.operations[0];
  if (op.type !== "invokeHostFunction") {
    throw new Error(`Expected invokeHostFunction, got ${op.type}`);
  }

  const alreadySigned: string[] = [];
  const pendingSignature: string[] = [];

  for (const entry of (op as Operation.InvokeHostFunction).auth ?? []) {
    const credType = entry.credentials().switch();
    if (credType === xdr.SorobanCredentialsType.sorobanCredentialsSourceAccount()) continue;
    if (credType === xdr.SorobanCredentialsType.sorobanCredentialsAddress()) {
      const addrCreds = entry.credentials().address();
      const address = Address.fromScAddress(addrCreds.address()).toString();
      const isSigned = addrCreds.signature().switch().name !== "scvVoid";
      (isSigned ? alreadySigned : pendingSignature).push(address);
    }
  }

  return {
    alreadySigned: [...new Set(alreadySigned)],
    pendingSignature: [...new Set(pendingSignature)],
  };
}
