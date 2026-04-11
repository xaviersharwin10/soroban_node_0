// Cross-Chain Token Bridge — Stellar ↔ EVM
//
// Users lock Stellar-native tokens and receive a signed release on the EVM side.
// Incoming bridge transfers (from EVM → Stellar) are minted by a trusted relayer.

use soroban_sdk::{
    contract, contractimpl, contracttype, token, Address, Bytes, Env, String,
};

#[contracttype]
pub enum DataKey {
    Admin,
    Relayer,
    SupportedToken(Address),   // true if the token is whitelisted for bridging
    Nonce(Address),             // per-user outbound nonce
    ProcessedNonce(u64),        // inbound nonces already processed (replay protection)
    BridgedOut(Address),        // cumulative amount bridged out per user
    PausedFlag,
}

#[contract]
pub struct TokenBridge;

#[contractimpl]
impl TokenBridge {
    pub fn initialize(env: Env, admin: Address, relayer: Address) {
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Relayer, &relayer);
        env.storage().instance().set(&DataKey::PausedFlag, &false);
    }

    /// Register a Stellar token as eligible for bridging.
    pub fn whitelist_token(env: Env, token: Address) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        env.storage()
            .instance()
            .set(&DataKey::SupportedToken(token), &true);
    }

    /// Lock tokens on Stellar and emit a bridge request to the EVM side.
    ///
    /// `token_address` is supplied by the caller — it is never validated
    /// against the whitelist, so a user can pass any contract address.
    pub fn bridge_out(
        env: Env,
        sender: Address,
        token_address: Address, // Unvalidated — caller can supply a malicious contract
        amount: i128,
        evm_recipient: Bytes,
    ) {
        sender.require_auth();

        // Whitelist check is missing — token_address accepted without verification
        // An attacker can point this at a token contract they control.

        let client = token::Client::new(&env, &token_address);
        // Return value from transfer is silently ignored
        client.transfer(&sender, &env.current_contract_address(), &amount);

        let nonce: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::Nonce(sender.clone()))
            .unwrap_or(0);

        env.storage()
            .persistent()
            .set(&DataKey::Nonce(sender.clone()), &(nonce + 1));

        let cumulative: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::BridgedOut(sender.clone()))
            .unwrap_or(0);

        // Unchecked addition — can overflow i128 for extremely large cumulative amounts
        env.storage()
            .persistent()
            .set(&DataKey::BridgedOut(sender.clone()), &(cumulative + amount));

        // No BridgeOut event emitted — off-chain relayer has no on-chain signal to act on
    }

    /// Mint tokens on the Stellar side for an inbound EVM → Stellar transfer.
    /// Only the trusted relayer may call this.
    pub fn bridge_in(
        env: Env,
        recipient: Address,
        token_address: Address,
        amount: i128,
        evm_nonce: u64,
    ) {
        let relayer: Address = env.storage().instance().get(&DataKey::Relayer).unwrap();
        relayer.require_auth();

        // Replay protection: reject already-processed nonces
        assert!(
            !env.storage()
                .instance()
                .get::<DataKey, bool>(&DataKey::ProcessedNonce(evm_nonce))
                .unwrap_or(false),
            "Nonce already processed"
        );

        env.storage()
            .instance()
            .set(&DataKey::ProcessedNonce(evm_nonce), &true);

        // token_address here is also caller-supplied — same missing validation
        let client = token::Client::new(&env, &token_address);
        client.transfer(&env.current_contract_address(), &recipient, &amount);

        // Missing SEP-41 event: bridge_in should emit a standardized event with
        // (recipient, token, amount, evm_nonce) so indexers can track inbound flows.
    }

    /// Update the trusted relayer address.
    /// No timelock — a compromised admin can instantly redirect all bridge_in calls.
    pub fn set_relayer(env: Env, new_relayer: Address) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        // Immediate effect — no timelock, no multisig, no on-chain delay
        env.storage().instance().set(&DataKey::Relayer, &new_relayer);
    }

    /// Emergency pause — only admin.
    pub fn pause(env: Env) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        env.storage().instance().set(&DataKey::PausedFlag, &true);
    }

    pub fn is_paused(env: Env) -> bool {
        env.storage()
            .instance()
            .get(&DataKey::PausedFlag)
            .unwrap_or(false)
    }
}
