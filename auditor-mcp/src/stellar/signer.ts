import { Keypair } from "@stellar/stellar-sdk";
import { basicNodeSigner, type SignAuthEntry, type SignTransaction } from "@stellar/stellar-sdk/contract";
import { STELLAR_TESTNET_CAIP2 } from "./constants";
import { getNetworkPassphrase } from "./utils";
import type { Network } from "@x402/core/types";

export type Ed25519Signer = {
  address: string;
  signAuthEntry: SignAuthEntry;
  signTransaction: SignTransaction;
};

export type ClientStellarSigner = {
  address: string;
  signAuthEntry: SignAuthEntry;
  signTransaction?: SignTransaction;
};

export function createEd25519Signer(
  privateKey: string,
  defaultNetwork: Network = STELLAR_TESTNET_CAIP2,
): Ed25519Signer {
  const kp = Keypair.fromSecret(privateKey);
  const networkPassphrase = getNetworkPassphrase(defaultNetwork);
  const address = kp.publicKey();
  const { signAuthEntry, signTransaction } = basicNodeSigner(kp, networkPassphrase);
  return { address, signAuthEntry, signTransaction };
}
