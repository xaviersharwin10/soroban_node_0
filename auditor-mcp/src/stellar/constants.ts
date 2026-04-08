export const STELLAR_PUBNET_CAIP2 = "stellar:pubnet";
export const STELLAR_TESTNET_CAIP2 = "stellar:testnet";
export const STELLAR_WILDCARD_CAIP2 = "stellar:*";

export const DEFAULT_TESTNET_RPC_URL = "https://soroban-testnet.stellar.org";

export const STELLAR_DESTINATION_ADDRESS_REGEX =
  /^(?:[GC][ABCD][A-Z2-7]{54}|M[ABCD][A-Z2-7]{67})$/;
export const STELLAR_ASSET_ADDRESS_REGEX = /^(?:[C][ABCD][A-Z2-7]{54})$/;

export const USDC_PUBNET_ADDRESS = "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75";
export const USDC_TESTNET_ADDRESS = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";

export const STELLAR_NETWORK_TO_PASSPHRASE: ReadonlyMap<string, string> = new Map([
  [STELLAR_PUBNET_CAIP2, "Public Global Stellar Network ; September 2015"],
  [STELLAR_TESTNET_CAIP2, "Test SDF Network ; September 2015"],
]);

export const DEFAULT_TOKEN_DECIMALS = 7;
