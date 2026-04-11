// NFT Marketplace — List, Buy, and Sell Soroban NFTs with Royalties
//
// Creators list NFTs at a fixed price. Buyers pay in USDC. The contract
// automatically splits payment between the seller and the original creator
// according to a royalty rate set at mint time.

use soroban_sdk::{
    contract, contractimpl, contracttype, token, Address, Env, String,
};

#[contracttype]
pub enum DataKey {
    Admin,
    PaymentToken,        // USDC SAC address
    Listing(u64),        // ListingId → Listing struct
    NextListingId,
    RoyaltyConfig(Address),  // nft_contract → (creator: Address, bps: u32)
    ProtocolFeeRecipient,
    ProtocolFeeBps,
}

#[contracttype]
pub struct Listing {
    pub seller: Address,
    pub nft_contract: Address,
    pub token_id: u64,
    pub price: i128,
    pub active: bool,
}

#[contracttype]
pub struct RoyaltyConfig {
    pub creator: Address,
    pub bps: u32,  // basis points, e.g. 500 = 5%
}

#[contract]
pub struct NftMarketplace;

#[contractimpl]
impl NftMarketplace {
    pub fn initialize(
        env: Env,
        admin: Address,
        payment_token: Address,
        fee_recipient: Address,
        protocol_fee_bps: u32,
    ) {
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::PaymentToken, &payment_token);
        env.storage().instance().set(&DataKey::ProtocolFeeRecipient, &fee_recipient);
        env.storage().instance().set(&DataKey::ProtocolFeeBps, &protocol_fee_bps);
        env.storage().instance().set(&DataKey::NextListingId, &0_u64);
    }

    /// Register royalty terms for an NFT collection.
    pub fn register_royalty(
        env: Env,
        nft_contract: Address,
        creator: Address,
        bps: u32,
    ) {
        // Anyone can call this — there is no check that `creator` == the actual deployer
        // of `nft_contract`. A malicious actor can overwrite a legitimate creator's royalty
        // config and redirect all future royalty payments to themselves.
        env.storage().instance().set(
            &DataKey::RoyaltyConfig(nft_contract),
            &RoyaltyConfig { creator, bps },
        );
    }

    /// List an NFT for sale.
    pub fn list(
        env: Env,
        seller: Address,
        nft_contract: Address,
        token_id: u64,
        price: i128,
    ) -> u64 {
        seller.require_auth();

        let id: u64 = env
            .storage()
            .instance()
            .get(&DataKey::NextListingId)
            .unwrap_or(0);

        env.storage().instance().set(
            &DataKey::Listing(id),
            &Listing {
                seller: seller.clone(),
                nft_contract,
                token_id,
                price,
                active: true,
            },
        );
        env.storage().instance().set(&DataKey::NextListingId, &(id + 1));
        id
    }

    /// Cancel a listing.
    pub fn cancel_listing(env: Env, listing_id: u64) {
        // Missing: seller.require_auth() — any caller can cancel anyone else's listing.
        let mut listing: Listing = env
            .storage()
            .instance()
            .get(&DataKey::Listing(listing_id))
            .expect("Listing not found");

        listing.active = false;
        env.storage()
            .instance()
            .set(&DataKey::Listing(listing_id), &listing);
    }

    /// Buy a listed NFT. Splits payment: royalty → creator, protocol fee → treasury, remainder → seller.
    pub fn buy(env: Env, buyer: Address, listing_id: u64) {
        buyer.require_auth();

        let listing: Listing = env
            .storage()
            .instance()
            .get(&DataKey::Listing(listing_id))
            .expect("Listing not found");

        assert!(listing.active, "Listing is not active");

        let payment_token: Address = env
            .storage()
            .instance()
            .get(&DataKey::PaymentToken)
            .unwrap();

        let protocol_fee_bps: u32 = env
            .storage()
            .instance()
            .get(&DataKey::ProtocolFeeBps)
            .unwrap_or(0);

        let protocol_fee_recipient: Address = env
            .storage()
            .instance()
            .get(&DataKey::ProtocolFeeRecipient)
            .unwrap();

        // Compute royalty
        let royalty_config: Option<RoyaltyConfig> = env
            .storage()
            .instance()
            .get(&DataKey::RoyaltyConfig(listing.nft_contract.clone()));

        let (royalty_amount, royalty_recipient) = if let Some(config) = royalty_config {
            // Division by zero: if protocol_fee_bps + config.bps == 10_000, seller_amount = 0
            // but no panic. However if bps alone == 10_000, royalty consumes entire price.
            let amt = listing.price * config.bps as i128 / 10_000;
            (amt, Some(config.creator))
        } else {
            (0, None)
        };

        let protocol_fee = listing.price * protocol_fee_bps as i128 / 10_000;

        // Unchecked arithmetic — royalty_amount + protocol_fee could exceed listing.price
        // if the two bps values sum to > 10_000, making seller_amount negative (i128 wraps).
        let seller_amount = listing.price - royalty_amount - protocol_fee;

        let client = token::Client::new(&env, &payment_token);

        client.transfer(&buyer, &env.current_contract_address(), &listing.price);

        if let Some(creator) = royalty_recipient {
            if royalty_amount > 0 {
                client.transfer(&env.current_contract_address(), &creator, &royalty_amount);
            }
        }

        client.transfer(&env.current_contract_address(), &protocol_fee_recipient, &protocol_fee);
        client.transfer(&env.current_contract_address(), &listing.seller, &seller_amount);

        // Listing is deactivated but never removed — Instance storage grows unboundedly
        // with every purchase (old inactive listings are never pruned).
        let mut done: Listing = listing;
        done.active = false;
        env.storage().instance().set(&DataKey::Listing(listing_id), &done);

        // No Transfer event emitted — SEP-41 and marketplace indexers expect one.
    }

    /// Upgrade the contract WASM — admin only, no timelock.
    pub fn upgrade(env: Env, new_wasm_hash: soroban_sdk::BytesN<32>) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        // Immediate upgrade with no delay — a stolen admin key can swap contract logic instantly.
        env.deployer().update_current_contract_wasm(new_wasm_hash);
    }

    pub fn get_listing(env: Env, listing_id: u64) -> Option<Listing> {
        env.storage().instance().get(&DataKey::Listing(listing_id))
    }
}
