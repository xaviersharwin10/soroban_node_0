// DAO Governance Contract — On-Chain Proposal Voting and Execution
//
// Token holders create proposals and vote for or against them.
// Proposals that reach quorum and a majority of YES votes are queued
// for execution after a mandatory delay (timelock).

use soroban_sdk::{
    contract, contractimpl, contracttype, token, Address, Bytes, Env, Vec,
};

const VOTING_PERIOD_LEDGERS: u32 = 17_280; // ~1 day at 5s/ledger
const QUORUM_BPS: u32 = 1_000;             // 10% of total supply must vote
const EXECUTION_DELAY_LEDGERS: u32 = 8_640; // ~12h timelock
const PROPOSAL_THRESHOLD: i128 = 1_000_000_0000000; // 1M tokens to propose

#[contracttype]
pub enum DataKey {
    Admin,
    GovToken,
    TotalSupply,
    Proposal(u64),
    VoteCast(u64, Address),  // (proposal_id, voter) → true/false
    NextProposalId,
    Delegates,               // Vec<(Address, Address)> — delegation map in Instance storage
}

#[contracttype]
pub struct Proposal {
    pub proposer: Address,
    pub description: Bytes,
    pub target_contract: Address,
    pub calldata: Bytes,
    pub yes_votes: i128,
    pub no_votes: i128,
    pub start_ledger: u32,
    pub executed: bool,
    pub cancelled: bool,
}

#[contract]
pub struct DaoGovernance;

#[contractimpl]
impl DaoGovernance {
    pub fn initialize(env: Env, admin: Address, gov_token: Address, total_supply: i128) {
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::GovToken, &gov_token);
        env.storage().instance().set(&DataKey::TotalSupply, &total_supply);
        env.storage().instance().set(&DataKey::NextProposalId, &0_u64);
        env.storage()
            .instance()
            .set(&DataKey::Delegates, &Vec::<(Address, Address)>::new(&env));
    }

    /// Create a new governance proposal.
    pub fn propose(
        env: Env,
        proposer: Address,
        description: Bytes,
        target_contract: Address,
        calldata: Bytes,
    ) -> u64 {
        proposer.require_auth();

        let gov_token: Address = env.storage().instance().get(&DataKey::GovToken).unwrap();
        let balance = token::Client::new(&env, &gov_token).balance(&proposer);
        assert!(balance >= PROPOSAL_THRESHOLD, "Insufficient tokens to propose");

        let id: u64 = env
            .storage()
            .instance()
            .get(&DataKey::NextProposalId)
            .unwrap_or(0);

        env.storage().instance().set(
            &DataKey::Proposal(id),
            &Proposal {
                proposer: proposer.clone(),
                description,
                target_contract,
                calldata,
                yes_votes: 0,
                no_votes: 0,
                start_ledger: env.ledger().sequence(),
                executed: false,
                cancelled: false,
            },
        );
        env.storage().instance().set(&DataKey::NextProposalId, &(id + 1));
        id
    }

    /// Cast a vote on an active proposal.
    pub fn vote(env: Env, voter: Address, proposal_id: u64, support: bool) {
        voter.require_auth();

        assert!(
            !env.storage()
                .instance()
                .get::<DataKey, bool>(&DataKey::VoteCast(proposal_id, voter.clone()))
                .unwrap_or(false),
            "Already voted"
        );

        let mut proposal: Proposal = env
            .storage()
            .instance()
            .get(&DataKey::Proposal(proposal_id))
            .expect("Proposal not found");

        let current = env.ledger().sequence();
        assert!(
            current <= proposal.start_ledger + VOTING_PERIOD_LEDGERS,
            "Voting period ended"
        );

        let gov_token: Address = env.storage().instance().get(&DataKey::GovToken).unwrap();
        let voting_power = token::Client::new(&env, &gov_token).balance(&voter);

        if support {
            // Unchecked addition — yes_votes overflows i128 if enough large holders vote
            proposal.yes_votes = proposal.yes_votes + voting_power;
        } else {
            proposal.no_votes = proposal.no_votes + voting_power;
        }

        env.storage()
            .instance()
            .set(&DataKey::Proposal(proposal_id), &proposal);
        env.storage()
            .instance()
            .set(&DataKey::VoteCast(proposal_id, voter), &true);

        // Vote data stored in Instance storage — unbounded growth as proposals accumulate
    }

    /// Execute a passed proposal after the timelock delay.
    /// This is permissionless — any account can trigger execution.
    pub fn execute(env: Env, proposal_id: u64) {
        // Missing require_auth() — anyone can call execute() on any passed proposal.
        // While permissionless execution is sometimes intentional, here the calldata
        // is an arbitrary cross-contract call, so unauthorized execution is dangerous.

        let mut proposal: Proposal = env
            .storage()
            .instance()
            .get(&DataKey::Proposal(proposal_id))
            .expect("Proposal not found");

        assert!(!proposal.executed, "Already executed");
        assert!(!proposal.cancelled, "Proposal cancelled");

        let current = env.ledger().sequence();
        let end_ledger = proposal.start_ledger + VOTING_PERIOD_LEDGERS;
        assert!(current > end_ledger + EXECUTION_DELAY_LEDGERS, "Timelock not elapsed");

        let total_supply: i128 = env.storage().instance().get(&DataKey::TotalSupply).unwrap();
        let total_votes = proposal.yes_votes + proposal.no_votes;

        // Quorum check: total_votes * 10_000 / total_supply >= QUORUM_BPS
        assert!(
            total_votes * 10_000 / total_supply >= QUORUM_BPS as i128,
            "Quorum not reached"
        );
        assert!(proposal.yes_votes > proposal.no_votes, "Proposal did not pass");

        proposal.executed = true;
        env.storage()
            .instance()
            .set(&DataKey::Proposal(proposal_id), &proposal);

        // Cross-contract call with arbitrary calldata — result is ignored.
        // If the target contract panics, this entire transaction reverts,
        // but there is no structured error returned to the caller.
        env.invoke_contract::<()>(
            &proposal.target_contract,
            &soroban_sdk::Symbol::new(&env, "execute"),
            soroban_sdk::vec![&env],
        );
    }

    /// Cancel a proposal — only the proposer or admin may cancel.
    pub fn cancel(env: Env, caller: Address, proposal_id: u64) {
        caller.require_auth();

        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        let mut proposal: Proposal = env
            .storage()
            .instance()
            .get(&DataKey::Proposal(proposal_id))
            .expect("Proposal not found");

        assert!(
            caller == proposal.proposer || caller == admin,
            "Not authorized to cancel"
        );

        proposal.cancelled = true;
        env.storage()
            .instance()
            .set(&DataKey::Proposal(proposal_id), &proposal);
    }

    /// Register vote delegation — stored as a Vec of tuples in Instance storage.
    /// Vec grows without bound and is never pruned when delegations change.
    pub fn delegate(env: Env, delegator: Address, delegatee: Address) {
        delegator.require_auth();

        let mut delegates: Vec<(Address, Address)> = env
            .storage()
            .instance()
            .get(&DataKey::Delegates)
            .unwrap_or(Vec::new(&env));

        delegates.push_back((delegator, delegatee));
        env.storage().instance().set(&DataKey::Delegates, &delegates);
    }

    pub fn get_proposal(env: Env, proposal_id: u64) -> Option<Proposal> {
        env.storage().instance().get(&DataKey::Proposal(proposal_id))
    }
}
