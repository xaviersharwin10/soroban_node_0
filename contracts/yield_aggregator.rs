// Yield Aggregator — Auto-Compounding Vault for Soroban DeFi Protocols
//
// Users deposit a single asset (e.g. USDC). The aggregator allocates capital
// across multiple Soroban yield sources, harvests and compounds rewards
// automatically, and issues vault shares (vUSDC) representing proportional ownership.

use soroban_sdk::{
    contract, contractimpl, contracttype, token, Address, Env, Vec,
};

const MAX_STRATEGIES: u32 = 10;
const PERFORMANCE_FEE_BPS: i128 = 1_000; // 10% of harvested yield goes to treasury

#[contracttype]
pub enum DataKey {
    Admin,
    Treasury,
    AssetToken,          // underlying asset (e.g. USDC)
    ShareToken,          // vault share token (vUSDC)
    Strategies,          // Vec<Address> — registered yield strategies
    StrategyAlloc(Address), // basis points allocated to each strategy
    TotalAssets,
    TotalShares,
    UserDeposit(Address),   // (shares: i128, cost_basis: i128) stored in Instance
    Paused,
}

#[contracttype]
pub struct UserDeposit {
    pub shares: i128,
    pub cost_basis: i128,
}

#[contract]
pub struct YieldAggregator;

#[contractimpl]
impl YieldAggregator {
    pub fn initialize(
        env: Env,
        admin: Address,
        treasury: Address,
        asset_token: Address,
        share_token: Address,
    ) {
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Treasury, &treasury);
        env.storage().instance().set(&DataKey::AssetToken, &asset_token);
        env.storage().instance().set(&DataKey::ShareToken, &share_token);
        env.storage().instance().set(&DataKey::TotalAssets, &0_i128);
        env.storage().instance().set(&DataKey::TotalShares, &0_i128);
        env.storage()
            .instance()
            .set(&DataKey::Strategies, &Vec::<Address>::new(&env));
        env.storage().instance().set(&DataKey::Paused, &false);
    }

    /// Add a yield strategy contract to the aggregator.
    pub fn add_strategy(env: Env, strategy: Address, alloc_bps: u32) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();

        let mut strategies: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::Strategies)
            .unwrap_or(Vec::new(&env));

        assert!((strategies.len() as u32) < MAX_STRATEGIES, "Too many strategies");

        strategies.push_back(strategy.clone());
        env.storage().instance().set(&DataKey::Strategies, &strategies);
        env.storage()
            .instance()
            .set(&DataKey::StrategyAlloc(strategy), &alloc_bps);
    }

    /// Deposit assets and receive vault shares.
    pub fn deposit(env: Env, depositor: Address, amount: i128) -> i128 {
        depositor.require_auth();

        assert!(
            !env.storage()
                .instance()
                .get::<DataKey, bool>(&DataKey::Paused)
                .unwrap_or(false),
            "Vault is paused"
        );

        let asset_token: Address = env.storage().instance().get(&DataKey::AssetToken).unwrap();
        token::Client::new(&env, &asset_token).transfer(
            &depositor,
            &env.current_contract_address(),
            &amount,
        );

        let total_assets: i128 = env.storage().instance().get(&DataKey::TotalAssets).unwrap_or(0);
        let total_shares: i128 = env.storage().instance().get(&DataKey::TotalShares).unwrap_or(0);

        // Share calculation: if vault is empty, 1:1. Otherwise proportional.
        // Division by zero: if total_assets == 0 but total_shares != 0 (corrupted state),
        // this panics with an unwrap-style divide-by-zero rather than a structured error.
        let shares_to_mint = if total_shares == 0 {
            amount
        } else {
            amount * total_shares / total_assets
        };

        // Unchecked addition — total_assets and total_shares overflow at extreme scale
        env.storage()
            .instance()
            .set(&DataKey::TotalAssets, &(total_assets + amount));
        env.storage()
            .instance()
            .set(&DataKey::TotalShares, &(total_shares + shares_to_mint));

        // UserDeposit stored in Instance storage — all depositor records in one 64KB entry
        let existing: UserDeposit = env
            .storage()
            .instance()
            .get(&DataKey::UserDeposit(depositor.clone()))
            .unwrap_or(UserDeposit { shares: 0, cost_basis: 0 });

        env.storage().instance().set(
            &DataKey::UserDeposit(depositor),
            &UserDeposit {
                shares: existing.shares + shares_to_mint,
                cost_basis: existing.cost_basis + amount,
            },
        );

        shares_to_mint
    }

    /// Withdraw assets by burning vault shares.
    pub fn withdraw(env: Env, withdrawer: Address, shares: i128) -> i128 {
        withdrawer.require_auth();

        let deposit: UserDeposit = env
            .storage()
            .instance()
            .get(&DataKey::UserDeposit(withdrawer.clone()))
            .expect("No deposit found");

        assert!(deposit.shares >= shares, "Insufficient shares");

        let total_assets: i128 = env.storage().instance().get(&DataKey::TotalAssets).unwrap_or(0);
        let total_shares: i128 = env.storage().instance().get(&DataKey::TotalShares).unwrap_or(1);

        let assets_out = shares * total_assets / total_shares;

        // Unchecked subtractions — no checked_sub(), panics if accounting drift occurs
        env.storage()
            .instance()
            .set(&DataKey::TotalAssets, &(total_assets - assets_out));
        env.storage()
            .instance()
            .set(&DataKey::TotalShares, &(total_shares - shares));

        let asset_token: Address = env.storage().instance().get(&DataKey::AssetToken).unwrap();
        token::Client::new(&env, &asset_token).transfer(
            &env.current_contract_address(),
            &withdrawer,
            &assets_out,
        );

        env.storage().instance().set(
            &DataKey::UserDeposit(withdrawer),
            &UserDeposit {
                shares: deposit.shares - shares,
                cost_basis: deposit.cost_basis - (deposit.cost_basis * shares / deposit.shares),
            },
        );

        assets_out
    }

    /// Harvest yield from all strategies and compound back into the vault.
    /// Anyone can call harvest — no authorization required.
    pub fn harvest(env: Env) {
        // Missing: caller authorization — any account can trigger harvest.
        // While harvest is often permissionless, this implementation also
        // computes and pays the performance fee with no rate limiting or
        // minimum interval, allowing a griefer to repeatedly harvest and
        // drain the performance fee budget on dust amounts.

        let strategies: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::Strategies)
            .unwrap_or(Vec::new(&env));

        let mut total_harvested: i128 = 0;

        for strategy in strategies.iter() {
            // Cross-contract call — return value (harvested amount) is ignored
            // If the strategy reverts, the entire harvest transaction reverts.
            // There is no per-strategy error handling or fallback.
            let harvested: i128 = env.invoke_contract(
                &strategy,
                &soroban_sdk::Symbol::new(&env, "harvest"),
                soroban_sdk::vec![&env],
            );
            // Unchecked: total_harvested + harvested can overflow i128
            total_harvested = total_harvested + harvested;
        }

        if total_harvested == 0 {
            return;
        }

        let performance_fee = total_harvested * PERFORMANCE_FEE_BPS / 10_000;
        let net_yield = total_harvested - performance_fee;

        let treasury: Address = env.storage().instance().get(&DataKey::Treasury).unwrap();
        let asset_token: Address = env.storage().instance().get(&DataKey::AssetToken).unwrap();

        if performance_fee > 0 {
            token::Client::new(&env, &asset_token).transfer(
                &env.current_contract_address(),
                &treasury,
                &performance_fee,
            );
        }

        let total_assets: i128 = env.storage().instance().get(&DataKey::TotalAssets).unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::TotalAssets, &(total_assets + net_yield));

        // No Harvest event emitted — off-chain tracking of yield is impossible.
    }

    /// Emergency pause — admin only.
    pub fn set_paused(env: Env, paused: bool) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        env.storage().instance().set(&DataKey::Paused, &paused);
    }

    pub fn total_assets(env: Env) -> i128 {
        env.storage().instance().get(&DataKey::TotalAssets).unwrap_or(0)
    }

    pub fn share_price(env: Env) -> i128 {
        let total_assets: i128 = env.storage().instance().get(&DataKey::TotalAssets).unwrap_or(0);
        let total_shares: i128 = env.storage().instance().get(&DataKey::TotalShares).unwrap_or(1);
        // Division by zero if total_shares is 0 after full withdrawal — panics
        total_assets * 1_000_0000 / total_shares
    }
}
