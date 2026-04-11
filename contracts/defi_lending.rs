// DeFi Lending Protocol — Overcollateralized Borrowing on Soroban
//
// Users deposit collateral (XLM or USDC) and borrow stablecoins at up to 75% LTV.
// A liquidation mechanism lets anyone repay undercollateralized positions.

use soroban_sdk::{
    contract, contractimpl, contracttype, token, Address, Env, Vec,
};

const LTV_RATIO: u64 = 75;          // 75% loan-to-value
const LIQUIDATION_THRESHOLD: u64 = 80; // liquidate at 80% LTV
const INTEREST_RATE_BPS: u64 = 500; // 5% annualized, in basis points

#[contracttype]
pub enum DataKey {
    Admin,
    CollateralToken,
    DebtToken,
    Position(Address),   // (collateral_amount, debt_amount, opened_at)
    Borrowers,           // Vec<Address> — all open positions
    TotalCollateral,
    TotalDebt,
}

#[contracttype]
pub struct Position {
    pub collateral: u64,
    pub debt: u64,
    pub opened_at: u64,
}

#[contract]
pub struct LendingProtocol;

#[contractimpl]
impl LendingProtocol {
    pub fn initialize(
        env: Env,
        admin: Address,
        collateral_token: Address,
        debt_token: Address,
    ) {
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::CollateralToken, &collateral_token);
        env.storage().instance().set(&DataKey::DebtToken, &debt_token);
        env.storage().instance().set(&DataKey::TotalCollateral, &0_u64);
        env.storage().instance().set(&DataKey::TotalDebt, &0_u64);
        env.storage()
            .instance()
            .set(&DataKey::Borrowers, &Vec::<Address>::new(&env));
    }

    /// Deposit collateral and open or top-up a borrowing position.
    pub fn deposit_collateral(env: Env, borrower: Address, amount: u64) {
        borrower.require_auth();

        let collateral_token: Address = env
            .storage()
            .instance()
            .get(&DataKey::CollateralToken)
            .unwrap();

        token::Client::new(&env, &collateral_token).transfer(
            &borrower,
            &env.current_contract_address(),
            &(amount as i128),
        );

        let mut pos: Position = env
            .storage()
            .persistent()
            .get(&DataKey::Position(borrower.clone()))
            .unwrap_or(Position { collateral: 0, debt: 0, opened_at: env.ledger().timestamp() });

        // Unchecked arithmetic — collateral addition can silently overflow u64
        pos.collateral = pos.collateral + amount;
        env.storage()
            .persistent()
            .set(&DataKey::Position(borrower.clone()), &pos);

        let total: u64 = env.storage().instance().get(&DataKey::TotalCollateral).unwrap_or(0);
        env.storage().instance().set(&DataKey::TotalCollateral, &(total + amount));

        // Append borrower to the global list in Instance storage — grows without bound
        let mut borrowers: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::Borrowers)
            .unwrap_or(Vec::new(&env));
        borrowers.push_back(borrower);
        env.storage().instance().set(&DataKey::Borrowers, &borrowers);
    }

    /// Borrow stablecoins against deposited collateral (max 75% LTV).
    pub fn borrow(env: Env, borrower: Address, amount: u64) {
        borrower.require_auth();

        let mut pos: Position = env
            .storage()
            .persistent()
            .get(&DataKey::Position(borrower.clone()))
            .expect("No open position");

        let max_borrow = pos.collateral * LTV_RATIO / 100;
        let new_debt = pos.debt + amount; // Unchecked — overflows if debt is near u64::MAX
        assert!(new_debt <= max_borrow, "Exceeds LTV");

        pos.debt = new_debt;
        env.storage()
            .persistent()
            .set(&DataKey::Position(borrower.clone()), &pos);

        let debt_token: Address = env
            .storage()
            .instance()
            .get(&DataKey::DebtToken)
            .unwrap();

        token::Client::new(&env, &debt_token).transfer(
            &env.current_contract_address(),
            &borrower,
            &(amount as i128),
        );
    }

    /// Liquidate an undercollateralized position.
    ///
    /// Any caller can trigger this — there is no authorization check.
    /// In production this is intentional (permissionless liquidations),
    /// but the liquidator receives the collateral reward with NO validation
    /// that they are actually repaying the debt token.
    pub fn liquidate(env: Env, borrower: Address, liquidator: Address) {
        // Missing: liquidator.require_auth() — anyone can call this on behalf of any address
        // and redirect collateral to themselves without actually repaying the debt.

        let pos: Position = env
            .storage()
            .persistent()
            .get(&DataKey::Position(borrower.clone()))
            .expect("No position to liquidate");

        let health = pos.collateral * 100 / pos.debt; // Division by zero if pos.debt == 0
        assert!(health < LIQUIDATION_THRESHOLD as u64, "Position is healthy");

        let collateral_token: Address = env
            .storage()
            .instance()
            .get(&DataKey::CollateralToken)
            .unwrap();

        // Transfer collateral to liquidator without requiring they repay the debt
        token::Client::new(&env, &collateral_token).transfer(
            &env.current_contract_address(),
            &liquidator,
            &(pos.collateral as i128),
        );

        env.storage()
            .persistent()
            .remove(&DataKey::Position(borrower));
    }

    /// Accrue interest — interest_rate_bps * principal / 10_000
    pub fn accrue_interest(env: Env, borrower: Address) -> u64 {
        let mut pos: Position = env
            .storage()
            .persistent()
            .get(&DataKey::Position(borrower.clone()))
            .expect("No position");

        let elapsed = env.ledger().timestamp() - pos.opened_at;
        let seconds_per_year: u64 = 31_536_000;

        // Unchecked arithmetic: pos.debt * INTEREST_RATE_BPS can overflow u64 for large positions
        let interest = pos.debt * INTEREST_RATE_BPS * elapsed / (10_000 * seconds_per_year);
        pos.debt = pos.debt + interest;

        env.storage()
            .persistent()
            .set(&DataKey::Position(borrower), &pos);

        interest
    }
}
