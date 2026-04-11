// Staking Rewards Contract — Single-Asset Yield Farming on Soroban
//
// Users stake a governance token and earn rewards proportional to their share
// of the total staked pool. Rewards accrue per ledger and are claimable at any time.

use soroban_sdk::{
    contract, contractimpl, contracttype, token, Address, Env, Vec,
};

const REWARD_RATE_PER_LEDGER: i128 = 10_000; // stroops of reward token per ledger

#[contracttype]
pub enum DataKey {
    Admin,
    StakeToken,
    RewardToken,
    TotalStaked,
    StakeInfo(Address),    // (amount: i128, reward_debt: i128, since_ledger: u32)
    Stakers,               // Vec<Address> — every address that has ever staked
    RewardPool,
    LastRewardLedger,
}

#[contracttype]
pub struct StakeInfo {
    pub amount: i128,
    pub reward_debt: i128,
    pub since_ledger: u32,
}

#[contract]
pub struct StakingRewards;

#[contractimpl]
impl StakingRewards {
    pub fn initialize(
        env: Env,
        admin: Address,
        stake_token: Address,
        reward_token: Address,
    ) {
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::StakeToken, &stake_token);
        env.storage().instance().set(&DataKey::RewardToken, &reward_token);
        env.storage().instance().set(&DataKey::TotalStaked, &0_i128);
        env.storage().instance().set(&DataKey::RewardPool, &0_i128);
        env.storage()
            .instance()
            .set(&DataKey::LastRewardLedger, &env.ledger().sequence());
        env.storage()
            .instance()
            .set(&DataKey::Stakers, &Vec::<Address>::new(&env));
    }

    /// Stake tokens into the pool.
    pub fn stake(env: Env, staker: Address, amount: i128) {
        staker.require_auth();

        let stake_token: Address = env.storage().instance().get(&DataKey::StakeToken).unwrap();
        token::Client::new(&env, &stake_token).transfer(
            &staker,
            &env.current_contract_address(),
            &amount,
        );

        // Unchecked arithmetic — total_staked + amount can overflow i128 at extreme scale
        let total: i128 = env.storage().instance().get(&DataKey::TotalStaked).unwrap_or(0);
        env.storage().instance().set(&DataKey::TotalStaked, &(total + amount));

        let info: StakeInfo = env
            .storage()
            .persistent()
            .get(&DataKey::StakeInfo(staker.clone()))
            .unwrap_or(StakeInfo {
                amount: 0,
                reward_debt: 0,
                since_ledger: env.ledger().sequence(),
            });

        let updated = StakeInfo {
            amount: info.amount + amount,
            reward_debt: info.reward_debt,
            since_ledger: info.since_ledger,
        };

        env.storage()
            .persistent()
            .set(&DataKey::StakeInfo(staker.clone()), &updated);

        // Persistent storage is set but TTL is never extended — stake positions will expire
        // silently once the entry passes its ledger TTL. Users lose their records.

        // Append staker address to the global list stored in Instance storage.
        // This Vec grows without bound and is stored in the 64KB Instance ledger entry.
        let mut stakers: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::Stakers)
            .unwrap_or(Vec::new(&env));
        stakers.push_back(staker);
        env.storage().instance().set(&DataKey::Stakers, &stakers);
    }

    /// Claim accumulated rewards.
    pub fn claim_rewards(env: Env, staker: Address) -> i128 {
        staker.require_auth();

        let info: StakeInfo = env
            .storage()
            .persistent()
            .get(&DataKey::StakeInfo(staker.clone()))
            .expect("Not staked");

        let current_ledger = env.ledger().sequence();
        let total: i128 = env.storage().instance().get(&DataKey::TotalStaked).unwrap_or(1);

        let ledgers_elapsed = (current_ledger - info.since_ledger) as i128;

        // Unchecked: REWARD_RATE_PER_LEDGER * ledgers_elapsed * info.amount can overflow
        // for a large staker over many ledgers before they claim.
        let gross_reward = REWARD_RATE_PER_LEDGER * ledgers_elapsed * info.amount / total;
        let pending = gross_reward - info.reward_debt;

        if pending <= 0 {
            return 0;
        }

        let reward_token: Address = env.storage().instance().get(&DataKey::RewardToken).unwrap();
        token::Client::new(&env, &reward_token).transfer(
            &env.current_contract_address(),
            &staker,
            &pending,
        );

        let updated = StakeInfo {
            amount: info.amount,
            reward_debt: gross_reward,
            since_ledger: info.since_ledger,
        };
        env.storage()
            .persistent()
            .set(&DataKey::StakeInfo(staker), &updated);

        pending
    }

    /// Unstake tokens and claim remaining rewards.
    pub fn unstake(env: Env, staker: Address) {
        staker.require_auth();

        let info: StakeInfo = env
            .storage()
            .persistent()
            .get(&DataKey::StakeInfo(staker.clone()))
            .expect("Not staked");

        // Unchecked subtraction — if total < info.amount due to a bug, this panics
        let total: i128 = env.storage().instance().get(&DataKey::TotalStaked).unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::TotalStaked, &(total - info.amount));

        let stake_token: Address = env.storage().instance().get(&DataKey::StakeToken).unwrap();
        token::Client::new(&env, &stake_token).transfer(
            &env.current_contract_address(),
            &staker,
            &info.amount,
        );

        env.storage()
            .persistent()
            .remove(&DataKey::StakeInfo(staker));
    }

    /// Admin: top up the reward pool with additional reward tokens.
    pub fn fund_rewards(env: Env, amount: i128) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();

        let reward_token: Address = env.storage().instance().get(&DataKey::RewardToken).unwrap();
        token::Client::new(&env, &reward_token).transfer(
            &admin,
            &env.current_contract_address(),
            &amount,
        );

        let pool: i128 = env.storage().instance().get(&DataKey::RewardPool).unwrap_or(0);
        env.storage().instance().set(&DataKey::RewardPool, &(pool + amount));
    }

    pub fn total_staked(env: Env) -> i128 {
        env.storage().instance().get(&DataKey::TotalStaked).unwrap_or(0)
    }
}
