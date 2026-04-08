// ⚠️ INTENTIONALLY VULNERABLE — for audit testing only
// Vulnerabilities included:
//   1. Missing require_auth() on withdraw() — anyone can drain funds
//   2. Unchecked arithmetic — balance + amount can overflow silently
//   3. Unbounded Instance storage Vec — DoS via infinite growth

use soroban_sdk::{contract, contractimpl, contracttype, token, Address, Env, Vec};

#[contracttype]
pub enum DataKey {
    Balance,
    Owner,
    Depositors,  // ⚠️ Vec stored in Instance storage — grows unboundedly
}

#[contract]
pub struct Vault;

#[contractimpl]
impl Vault {
    /// Initialize the vault with an owner.
    pub fn init(env: Env, owner: Address) {
        owner.require_auth();
        env.storage().instance().set(&DataKey::Owner, &owner);
        env.storage().instance().set(&DataKey::Balance, &0_i128);
        env.storage()
            .instance()
            .set(&DataKey::Depositors, &Vec::<Address>::new(&env));
    }

    /// Deposit USDC into the vault.
    pub fn deposit(env: Env, from: Address, token_address: Address, amount: i128) {
        from.require_auth();

        // ⚠️ VULNERABILITY 2: unchecked arithmetic — no checked_add()
        let current: i128 = env
            .storage()
            .instance()
            .get(&DataKey::Balance)
            .unwrap_or(0);
        let new_balance = current + amount; // silent overflow possible
        env.storage()
            .instance()
            .set(&DataKey::Balance, &new_balance);

        // ⚠️ VULNERABILITY 3: appending to a Vec in Instance storage — unbounded growth
        let mut depositors: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::Depositors)
            .unwrap_or(Vec::new(&env));
        depositors.push_back(from.clone());
        env.storage()
            .instance()
            .set(&DataKey::Depositors, &depositors);

        token::Client::new(&env, &token_address).transfer_from(
            &env.current_contract_address(),
            &from,
            &env.current_contract_address(),
            &amount,
        );
    }

    /// Withdraw USDC from the vault.
    ///
    /// ⚠️ VULNERABILITY 1: no require_auth() — any caller can withdraw all funds
    pub fn withdraw(env: Env, to: Address, token_address: Address, amount: i128) {
        // Missing: to.require_auth();   ← anyone can call this!

        let current: i128 = env
            .storage()
            .instance()
            .get(&DataKey::Balance)
            .unwrap_or(0);

        // ⚠️ Also unchecked subtraction — could underflow
        let new_balance = current - amount;
        env.storage()
            .instance()
            .set(&DataKey::Balance, &new_balance);

        token::Client::new(&env, &token_address).transfer(
            &env.current_contract_address(),
            &to,
            &amount,
        );
    }

    /// Return current vault balance.
    pub fn balance(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::Balance)
            .unwrap_or(0)
    }
}
