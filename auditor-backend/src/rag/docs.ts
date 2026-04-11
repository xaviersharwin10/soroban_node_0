// ---------------------------------------------------------------------------
// Curated Soroban security knowledge base
// Hardcoded as strings so they survive tsup bundling without file I/O.
// Sources: OpenZeppelin Stellar Contracts audits, Sanctifier S001–S012,
//          CoinFabrik Scout, Soroban SDK docs, published CVEs.
// ---------------------------------------------------------------------------

export interface Doc {
  id: string;
  title: string;
  content: string;
}

export const DOCS: Doc[] = [
  {
    id: "auth",
    title: "Soroban Authorization Vulnerabilities",
    content: `## Soroban Authorization Vulnerabilities

### S001 — Missing require_auth (CWE-862)

Every function that modifies contract state or transfers tokens MUST call require_auth() on the relevant Address before any state change or external call. Absence is always CRITICAL.

**Vulnerable pattern:**
\`\`\`rust
pub fn withdraw(env: Env, to: Address, amount: i128) {
    // BUG: no require_auth — anyone can call this
    let balance = env.storage().instance().get(&DataKey::Balance).unwrap_or(0_i128);
    env.storage().instance().set(&DataKey::Balance, &(balance - amount));
    token::Client::new(&env, &token_address).transfer(&env.current_contract_address(), &to, &amount);
}
\`\`\`

**Fixed pattern:**
\`\`\`rust
pub fn withdraw(env: Env, to: Address, amount: i128) {
    to.require_auth();  // Must be FIRST, before any storage reads or external calls
    let balance = env.storage().instance().get(&DataKey::Balance).unwrap_or(0_i128);
    env.storage().instance().set(&DataKey::Balance, &(balance - amount));
    token::Client::new(&env, &token_address).transfer(&env.current_contract_address(), &to, &amount);
}
\`\`\`

**Key rules:**
- require_auth() must be called BEFORE any storage reads (to prevent auth-bypass via reentrancy)
- require_auth_for_args() when auth should be scoped to specific arguments
- If a function is admin-only, call admin.require_auth() where admin is loaded from storage
- Constructor/init functions often need require_auth() on the deployer address

### Authorization Context Loss in Cross-Contract Calls

When contract A calls contract B, the authorization context from A's caller does NOT automatically propagate to B. Each contract call operates in its own auth context.

**Vulnerable pattern:**
\`\`\`rust
// Contract A — tries to "pass through" auth to contract B
pub fn proxy_deposit(env: Env, user: Address, amount: i128) {
    user.require_auth();  // Only authorizes THIS contract call
    // BUG: contract_b's deposit() needs its own require_auth — user hasn't authorized it
    ContractBClient::new(&env, &contract_b_address).deposit(&user, &amount);
}
\`\`\`

**Fix:** Use sub-invocation authorization or restructure so each contract verifies its own caller.

### #[has_role] vs #[only_role] (OpenZeppelin Stellar Contracts)

The \`#[has_role(Role::X)]\` macro ONLY checks if the caller has the role — it does NOT call require_auth(). The caller's identity is verified but not their authorization signature.

**Vulnerable:**
\`\`\`rust
#[has_role(Role::Admin)]
pub fn set_price(env: Env, caller: Address, price: i128) {
    // BUG: has_role checks the role but NOT the caller's auth signature
    env.storage().instance().set(&DataKey::Price, &price);
}
\`\`\`

**Fixed — use #[only_role] which enforces both:**
\`\`\`rust
#[only_role(Role::Admin)]
pub fn set_price(env: Env, caller: Address, price: i128) {
    // only_role calls require_auth() internally — safe
    env.storage().instance().set(&DataKey::Price, &price);
}
\`\`\`

OR manually add require_auth() alongside has_role:
\`\`\`rust
#[has_role(Role::Admin)]
pub fn set_price(env: Env, caller: Address, price: i128) {
    caller.require_auth();  // explicit require_auth alongside has_role
    env.storage().instance().set(&DataKey::Price, &price);
}
\`\`\`

### SDK Macro Bug — Function Name Shadowing (Soroban SDK < v25.1.1)

When a trait impl and an inherent impl both define a function with the same name, the Wasm export may point to the inherent (unprotected) version instead of the trait impl (protected version). The authorized version becomes unreachable.

**Indicator:** Two impls for the same contract struct with identical method names. Flag any such shadowing even if SDK is current, as the pattern is fragile.`,
  },

  {
    id: "arithmetic",
    title: "Soroban Arithmetic Safety",
    content: `## Soroban Arithmetic Safety

### S003 — Unchecked Arithmetic (CWE-190 / CWE-191)

Rust's default arithmetic panics on overflow in debug mode but WRAPS SILENTLY in release mode (which is how Soroban contracts are compiled for deployment). Silent wrapping causes catastrophic balance corruption in financial contracts.

**Vulnerable patterns:**
\`\`\`rust
// All of these wrap silently in release builds:
let new_balance = balance + amount;        // overflow
let new_balance = balance - amount;        // underflow → huge positive number
let shares = total_supply * rate / 1000;   // intermediate overflow
let fee = amount * fee_bps / 10000;        // overflow if amount is large
\`\`\`

**Fixed patterns — always use checked arithmetic:**
\`\`\`rust
let new_balance = balance.checked_add(amount)
    .unwrap_or_else(|| panic_with_error!(&env, Error::Overflow));

let new_balance = balance.checked_sub(amount)
    .unwrap_or_else(|| panic_with_error!(&env, Error::Underflow));

// For multiplication chains, check each step:
let intermediate = total_supply.checked_mul(rate)
    .unwrap_or_else(|| panic_with_error!(&env, Error::Overflow));
let shares = intermediate.checked_div(1000)
    .unwrap_or_else(|| panic_with_error!(&env, Error::DivByZero));
\`\`\`

### Integer Type Mismatch — u32/i32 for Token Amounts

SEP-41 token amounts are i128. Using u32 or i32 silently truncates any value above ~4.29 billion (u32 max) or ~2.15 billion (i32 max). For USDC with 7 decimal places, u32 overflow occurs at just 429 USDC.

**Vulnerable:**
\`\`\`rust
pub fn deposit(env: Env, amount: u32) {  // BUG: u32 truncates
    let balance: u32 = env.storage().instance().get(&DataKey::Balance).unwrap_or(0);
    env.storage().instance().set(&DataKey::Balance, &(balance + amount));
}
\`\`\`

**Fixed:**
\`\`\`rust
pub fn deposit(env: Env, amount: i128) {  // i128 required by SEP-41
    let balance: i128 = env.storage().instance().get(&DataKey::Balance).unwrap_or(0_i128);
    let new_balance = balance.checked_add(amount)
        .unwrap_or_else(|| panic_with_error!(&env, Error::Overflow));
    env.storage().instance().set(&DataKey::Balance, &new_balance);
}
\`\`\`

### Division by Zero (CWE-369)

Any division or modulo where the denominator could be zero causes a panic, making the contract call fail. In DeFi contracts, this commonly occurs when:
- Pool is empty (total_liquidity = 0)
- Rate/price is zero
- User-supplied denominator

**Vulnerable:**
\`\`\`rust
let price_per_share = total_value / total_shares;  // panics if total_shares == 0
let fee = amount % fee_denominator;                 // panics if fee_denominator == 0
\`\`\`

**Fixed:**
\`\`\`rust
if total_shares == 0 {
    panic_with_error!(&env, Error::PoolEmpty);
}
let price_per_share = total_value.checked_div(total_shares)
    .unwrap_or_else(|| panic_with_error!(&env, Error::DivByZero));
\`\`\`

### Precision Loss in Fixed-Point Math

Soroban has no native floating point in contracts. Fixed-point math with integer division loses precision. Always multiply before dividing to minimize truncation error.

**Imprecise:**
\`\`\`rust
let reward = stake_amount / total_staked * reward_pool;  // divides first → truncates
\`\`\`

**Better:**
\`\`\`rust
let reward = stake_amount.checked_mul(reward_pool)
    .and_then(|v| v.checked_div(total_staked))
    .unwrap_or_else(|| panic_with_error!(&env, Error::MathError));
\`\`\``,
  },

  {
    id: "storage",
    title: "Soroban Storage Safety and DoS",
    content: `## Soroban Storage Safety and DoS

### S004 — Unbounded Instance Storage DoS (CWE-400)

Soroban has three storage tiers: Instance, Persistent, and Temporary.

**Instance storage** is a SINGLE 64KB ledger entry shared by the entire contract. Every contract call loads and saves this entry. Storing unbounded collections (Vec, Map) in Instance storage causes:
- Progressive transaction fee increase as the entry grows
- ResourceLimitExceeded error after ~818–1636 entries (depending on entry size)
- All contract functions become uncallable — permanent DoS

**Vulnerable patterns:**
\`\`\`rust
// BUG: growing Vec in Instance storage — classic DoS
pub fn submit_proposal(env: Env, proposal: Proposal) {
    let mut proposals: Vec<Proposal> = env.storage().instance()
        .get(&DataKey::Proposals)
        .unwrap_or_default();
    proposals.push_back(proposal);  // unbounded growth
    env.storage().instance().set(&DataKey::Proposals, &proposals);
}

// BUG: per-user balances in Instance — DoS as users grow
pub fn record_balance(env: Env, user: Address, amount: i128) {
    let mut balances: Map<Address, i128> = env.storage().instance()
        .get(&DataKey::Balances)
        .unwrap_or_default();
    balances.set(user, amount);
    env.storage().instance().set(&DataKey::Balances, &balances);
}
\`\`\`

**Fixed — use Persistent storage with per-key entries:**
\`\`\`rust
// Each proposal gets its own Persistent storage entry
pub fn submit_proposal(env: Env, proposal_id: u32, proposal: Proposal) {
    env.storage().persistent()
        .set(&DataKey::Proposal(proposal_id), &proposal);
    // Bump TTL so it doesn't expire
    env.storage().persistent()
        .extend_ttl(&DataKey::Proposal(proposal_id), 100_000, 200_000);
}

// Per-user balances in Persistent storage
pub fn record_balance(env: Env, user: Address, amount: i128) {
    env.storage().persistent().set(&DataKey::Balance(user), &amount);
}
\`\`\`

### S005 — Storage Key Collisions (CWE-471)

If two different data types use the same DataKey discriminant or string key, one will silently overwrite the other. This is especially dangerous when migrating or adding new storage keys.

**Vulnerable:**
\`\`\`rust
#[contracttype]
enum DataKey {
    Admin,      // discriminant 0
    Balance,    // discriminant 1 — but if you add a new variant before Balance, everything shifts!
}
\`\`\`

**Safe pattern:** Always use explicit discriminants:
\`\`\`rust
#[contracttype]
enum DataKey {
    Admin = 0,
    Balance = 1,
    TotalSupply = 2,
    // New keys always get the NEXT number, never reuse or insert
    Proposals = 3,
}
\`\`\`

### TTL Mismanagement

Temporary storage entries EXPIRE after their TTL (Time to Live in ledgers). Using Temporary storage for data that must persist causes silent data loss.

Persistent entries also expire if not bumped — a contract that never calls extend_ttl() will eventually become inaccessible.

**Missing TTL bump:**
\`\`\`rust
pub fn initialize(env: Env, admin: Address) {
    env.storage().instance().set(&DataKey::Admin, &admin);
    // BUG: Instance storage TTL is not extended — contract will expire
}
\`\`\`

**Fixed:**
\`\`\`rust
pub fn initialize(env: Env, admin: Address) {
    env.storage().instance().set(&DataKey::Admin, &admin);
    env.storage().instance().extend_ttl(100_000, 200_000);  // bump TTL
}
// And in every subsequent call:
env.storage().instance().extend_ttl(100_000, 200_000);
\`\`\`

### Unauthorized TTL Extension Breaking Replay Protection

If a contract uses Temporary storage expiration as a nonce/replay protection mechanism, this protection is broken: any user can call Stellar's ExtendFootprintTTLOp to extend ANY ledger entry's TTL, preventing the nonce from ever expiring.

Never use TTL expiration as a security mechanism.`,
  },

  {
    id: "tokens",
    title: "Soroban Token Interface and SEP-41 Compliance",
    content: `## Soroban Token Interface and SEP-41 Compliance

### SEP-41 Required Interface

All Soroban fungible tokens must implement the SEP-41 interface exactly. Deviations cause incompatibility with wallets, DEXes, and DeFi protocols.

**Required methods with exact signatures:**
\`\`\`rust
fn allowance(env: Env, from: Address, spender: Address) -> i128;
fn approve(env: Env, from: Address, spender: Address, amount: i128, expiration_ledger: u32);
fn balance(env: Env, id: Address) -> i128;
fn transfer(env: Env, from: Address, to: Address, amount: i128);
fn transfer_from(env: Env, spender: Address, from: Address, to: Address, amount: i128);
fn burn(env: Env, from: Address, amount: i128);
fn burn_from(env: Env, spender: Address, from: Address, amount: i128);
fn decimals(env: Env) -> u32;
fn name(env: Env) -> String;
fn symbol(env: Env) -> String;
\`\`\`

Any wrong argument type (e.g., u32 for amount instead of i128) is a HIGH severity finding.

### S012 — Blocklist Bypass via Pre-Approved Allowances

transfer_from() allows spending on behalf of another address. If the implementation doesn't check the blocklist at transfer time (only at approve time), a blocked address can still have pre-approved allowances spent by others.

**Vulnerable:**
\`\`\`rust
pub fn transfer_from(env: Env, spender: Address, from: Address, to: Address, amount: i128) {
    spender.require_auth();
    // BUG: checks spender's blocklist but not the 'from' address blocklist
    check_not_blocked(&env, &spender);
    // ...
}
\`\`\`

**Fixed:**
\`\`\`rust
pub fn transfer_from(env: Env, spender: Address, from: Address, to: Address, amount: i128) {
    spender.require_auth();
    check_not_blocked(&env, &spender);
    check_not_blocked(&env, &from);  // Must check from address too
    check_not_blocked(&env, &to);
    // ...
}
\`\`\`

### Missing SEP-41 Events (S008 / CWE-223)

SEP-41 mandates specific events for transfer, approve, mint, burn. Missing events break indexers, wallets, and compliance tooling.

**Required events:**
- transfer: topics=[symbol!("transfer"), from, to], data=[amount]
- approve: topics=[symbol!("approve"), from, spender], data=[amount, expiration_ledger]
- mint: topics=[symbol!("mint"), admin, to], data=[amount]
- burn: topics=[symbol!("burn"), from], data=[amount]

\`\`\`rust
// Correct transfer event emission
env.events().publish(
    (symbol_short!("transfer"), from.clone(), to.clone()),
    amount
);
\`\`\`

### Missing FungibleBurnable — Incomplete burn/burn_from

burn() and burn_from() must:
1. Check blocklist (from, spender)
2. Verify and decrement allowance (for burn_from)
3. Deduct balance with underflow check
4. Emit burn event
5. Update total_supply

Omitting any step leaves the token in an inconsistent state.

\`\`\`rust
pub fn burn(env: Env, from: Address, amount: i128) {
    from.require_auth();
    check_not_blocked(&env, &from);
    let balance = get_balance(&env, &from);
    let new_balance = balance.checked_sub(amount)
        .unwrap_or_else(|| panic_with_error!(&env, Error::InsufficientBalance));
    set_balance(&env, &from, new_balance);
    let supply = get_total_supply(&env);
    set_total_supply(&env, supply.checked_sub(amount).unwrap());
    env.events().publish((symbol_short!("burn"), from), amount);
}
\`\`\``,
  },

  {
    id: "cves",
    title: "Soroban Known CVEs and SDK Bugs",
    content: `## Soroban Known CVEs and SDK Bugs

### GHSA-PM4J-7R4Q-CCG8 — Val Storage Corruption

**Severity:** CRITICAL
**Affected:** Soroban SDK (multiple versions)
**Reference:** https://github.com/advisories/GHSA-pm4j-7r4q-ccg8

Storing a Vec or Map containing certain prohibited types (e.g., MuxedAddress, or ScVal types not valid for storage) permanently corrupts the storage entry. The entry becomes unreadable — all future calls that load it will panic. This is irreversible without contract upgrade.

**Vulnerable:**
\`\`\`rust
// BUG: Vec<MuxedAddress> cannot be stored — corrupts the entry
let mut recipients: Vec<MuxedAddress> = Vec::new(&env);
recipients.push_back(muxed_addr);
env.storage().instance().set(&DataKey::Recipients, &recipients);
\`\`\`

**Vulnerable (arbitrary user data in storage):**
\`\`\`rust
pub fn store_payload(env: Env, payload: Val) {
    // BUG: Val can contain anything including invalid storage types
    env.storage().persistent().set(&DataKey::Payload, &payload);
}
\`\`\`

**Fixed — validate element types before storage:**
\`\`\`rust
// Only store Address (not MuxedAddress) in collections
let mut recipients: Vec<Address> = Vec::new(&env);
recipients.push_back(address);  // Address is always safe

// Validate user-supplied data before storing
pub fn store_payload(env: Env, amount: i128, recipient: Address) {
    // Use concrete types only — never raw Val
    env.storage().persistent().set(&DataKey::Amount, &amount);
    env.storage().persistent().set(&DataKey::Recipient, &recipient);
}
\`\`\`

**Detection patterns to flag:**
- Any function accepting \`Val\` parameter that stores it directly
- \`Vec<MuxedAddress>\` or \`Map\` with MuxedAddress values stored anywhere
- Storing \`ScVal\` types without type validation

### Soroban SDK Macro Bug — Wasm Export Mismatch (SDK < v25.1.1)

**Severity:** CRITICAL
**Affected:** soroban-sdk < v25.1.1

When a contract has both a trait impl and an inherent impl for the same struct, and they share a function name, the Wasm export may bind to the inherent impl (which may have no authorization checks) instead of the trait impl (which has proper checks). The protected path becomes unreachable.

**Vulnerable pattern:**
\`\`\`rust
// Trait impl — has auth check
impl SomeInterface for MyContract {
    fn execute(env: Env, caller: Address) {
        caller.require_auth();
        // safe logic
    }
}

// Inherent impl — no auth check, same name
impl MyContract {
    pub fn execute(env: Env, caller: Address) {
        // BUG: Wasm may export THIS version, bypassing require_auth
        // unsafe logic
    }
}
\`\`\`

**Fix:** Remove ambiguous method name shadowing. If both impls are needed, rename the inherent impl method. Always upgrade to soroban-sdk >= v25.1.1.

### Reentrancy in Soroban

Unlike EVM, Soroban does NOT support arbitrary reentrancy because cross-contract calls are synchronous and the ledger entry cache is write-buffered. However, auth-manipulation reentrancy is possible:

If a contract calls an external contract before completing its own state update, and that external contract calls back into the first contract, the first contract's state may be inconsistent.

**Best practice:** Always update ALL state before making external calls (checks-effects-interactions pattern):
\`\`\`rust
// CORRECT order:
fn withdraw(env: Env, to: Address, amount: i128) {
    to.require_auth();
    // 1. Update state FIRST
    let new_balance = get_balance(&env, &to) - amount;
    set_balance(&env, &to, new_balance);
    // 2. THEN make external call
    token_client.transfer(&env.current_contract_address(), &to, &amount);
}
\`\`\``,
  },

  {
    id: "cross_contract",
    title: "Soroban Cross-Contract Safety",
    content: `## Soroban Cross-Contract Safety

### Unvalidated External Contract Addresses (CWE-20)

When a contract accepts a contract address from user input and uses it to make a cross-contract call, a malicious user can redirect the call to an attacker-controlled contract.

**Vulnerable:**
\`\`\`rust
pub fn swap(env: Env, token_address: Address, amount: i128) {
    // BUG: token_address is user-supplied and unvalidated
    // Attacker can pass a malicious contract address
    token::Client::new(&env, &token_address)
        .transfer(&env.current_contract_address(), &get_pool(&env), &amount);
}
\`\`\`

**Fixed — validate against allowlist or stored address:**
\`\`\`rust
pub fn swap(env: Env, token_address: Address, amount: i128) {
    // Load the pre-approved token address from storage (set by admin at init)
    let approved_token: Address = env.storage().instance()
        .get(&DataKey::TokenAddress)
        .unwrap_or_else(|| panic_with_error!(&env, Error::NotInitialized));

    // Validate: only the approved token can be used
    if token_address != approved_token {
        panic_with_error!(&env, Error::InvalidToken);
    }

    token::Client::new(&env, &token_address)
        .transfer(&env.current_contract_address(), &get_pool(&env), &amount);
}
\`\`\`

### S009 — Ignored Return Values from Sub-Calls (CWE-252)

Cross-contract calls in Soroban return Result types. Dropping the result without handling the error means a failed sub-call goes undetected, leaving the caller in an inconsistent state.

**Vulnerable:**
\`\`\`rust
pub fn batch_transfer(env: Env, recipients: Vec<Address>, amounts: Vec<i128>) {
    for (recipient, amount) in recipients.iter().zip(amounts.iter()) {
        // BUG: if transfer fails, we continue — inconsistent state
        let _ = token_client.try_transfer(&env.current_contract_address(), &recipient, &amount);
    }
}
\`\`\`

**Fixed:**
\`\`\`rust
pub fn batch_transfer(env: Env, recipients: Vec<Address>, amounts: Vec<i128>) {
    for (recipient, amount) in recipients.iter().zip(amounts.iter()) {
        // Propagate errors — contract call reverts entirely if any transfer fails
        token_client.transfer(&env.current_contract_address(), &recipient, &amount);
        // OR: token_client.try_transfer(...).unwrap_or_else(|_| panic_with_error!(...));
    }
}
\`\`\`

### Authorization Context in Cross-Contract Calls

When contract A (with user U's authorization) calls contract B, contract B runs in a NEW authorization context. If contract B calls require_auth() on U, it will FAIL unless U pre-authorized contract B.

This means multi-step DeFi flows require explicit sub-authorization setup:

\`\`\`rust
// User must sign an authorization tree that covers both contracts:
// AuthEntry { contract: A, fn: "deposit", sub_invocations: [
//     AuthEntry { contract: token, fn: "transfer", ... }
// ]}
\`\`\`

**Common mistake:** Assuming that because a user called contract A with require_auth(), contract A can call any other contract on that user's behalf. It cannot without explicit sub-authorization.

### Oracle Manipulation via Unvalidated Price Sources

Contracts that read prices from an external oracle contract should validate:
1. The oracle address is the stored, admin-set address (not user-supplied)
2. The returned price is within reasonable bounds (circuit breaker)
3. The price was updated recently (freshness check via ledger sequence)

\`\`\`rust
pub fn get_safe_price(env: Env) -> i128 {
    let oracle_addr: Address = env.storage().instance().get(&DataKey::Oracle).unwrap();
    let oracle = OracleClient::new(&env, &oracle_addr);
    let (price, last_updated) = oracle.get_price();

    // Freshness check
    if env.ledger().sequence() - last_updated > MAX_PRICE_AGE_LEDGERS {
        panic_with_error!(&env, Error::StalePriceData);
    }
    // Bounds check
    if price <= 0 || price > MAX_REASONABLE_PRICE {
        panic_with_error!(&env, Error::InvalidPrice);
    }
    price
}
\`\`\``,
  },

  {
    id: "access_control",
    title: "Soroban Access Control and Upgrade Risks",
    content: `## Soroban Access Control and Upgrade Risks

### S010 — Upgrade Without Timelock (CWE-284)

Soroban contracts can be upgraded by replacing their Wasm code. If upgrade is callable by a single admin with no timelock, the admin (or an attacker who compromises the admin key) can silently swap the contract for a malicious version — stealing all funds instantly.

**Vulnerable:**
\`\`\`rust
pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) {
    let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
    admin.require_auth();
    // BUG: instant upgrade — no delay, no multisig, no timelock
    env.deployer().update_current_contract_wasm(new_wasm_hash);
}
\`\`\`

**Fixed — upgrade with timelock:**
\`\`\`rust
pub fn propose_upgrade(env: Env, new_wasm_hash: BytesN<32>) {
    let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
    admin.require_auth();
    let execute_after = env.ledger().sequence() + UPGRADE_DELAY_LEDGERS; // e.g., 17280 = ~1 day
    env.storage().instance().set(&DataKey::PendingUpgrade, &(new_wasm_hash, execute_after));
}

pub fn execute_upgrade(env: Env) {
    let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
    admin.require_auth();
    let (new_wasm_hash, execute_after): (BytesN<32>, u32) =
        env.storage().instance().get(&DataKey::PendingUpgrade)
            .unwrap_or_else(|| panic_with_error!(&env, Error::NoUpgradePending));
    if env.ledger().sequence() < execute_after {
        panic_with_error!(&env, Error::UpgradeNotReady);
    }
    env.deployer().update_current_contract_wasm(new_wasm_hash);
    env.storage().instance().remove(&DataKey::PendingUpgrade);
}
\`\`\`

### Admin Key in Mutable Instance Storage Without Rotation Mechanism

Storing admin in mutable storage is correct, but without a key rotation or multisig mechanism, a compromised admin key has no recovery path.

**Minimum safe pattern:**
\`\`\`rust
pub fn transfer_admin(env: Env, new_admin: Address) {
    let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
    admin.require_auth();
    new_admin.require_auth();  // new admin must also sign — prevents accidental lockout
    env.storage().instance().set(&DataKey::Admin, &new_admin);
}
\`\`\`

### Single-Admin Centralization Risk

Contracts where a single Address controls all critical functions (mint, upgrade, pause, parameter changes) with no multisig or governance represent extreme centralization risk. This is HIGH severity for any contract holding user funds.

**Indicators to flag:**
- Single DataKey::Admin controlling multiple sensitive operations
- No DAO/governance mechanism for fund-controlling contracts
- Admin can pause withdrawals without timelock

### S002 — Panic Anti-Patterns (CWE-248)

In Soroban contracts, bare panic!() and unwrap() should never appear in production code. They produce opaque error codes and don't conform to the contract's error type system.

**Vulnerable:**
\`\`\`rust
let balance = env.storage().instance().get(&DataKey::Balance).unwrap();  // opaque panic
let result = risky_operation().expect("this should never fail");  // opaque panic
panic!("unexpected state");  // opaque, no error code
\`\`\`

**Fixed:**
\`\`\`rust
#[contracterror]
#[derive(Copy, Clone)]
pub enum Error {
    NotInitialized = 1,
    InsufficientBalance = 2,
    Unauthorized = 3,
}

let balance: i128 = env.storage().instance().get(&DataKey::Balance)
    .unwrap_or_else(|| panic_with_error!(&env, Error::NotInitialized));

// For operations that should not fail:
let result = risky_operation()
    .unwrap_or_else(|_| panic_with_error!(&env, Error::UnexpectedState));
\`\`\`

### Error Propagation — Ignored Result Values (S009 / CWE-252)

Any Result<T, E> or Option<T> that is dropped with \`let _ = ...\` or used without handling the error case is a potential silent failure.

\`\`\`rust
// BAD
let _ = env.storage().persistent().get::<_, i128>(&DataKey::Balance);

// GOOD
let balance: i128 = env.storage().persistent()
    .get(&DataKey::Balance)
    .unwrap_or_else(|| panic_with_error!(&env, Error::NotInitialized));
\`\`\``,
  },
];
