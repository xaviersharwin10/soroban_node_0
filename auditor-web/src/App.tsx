import { useState, useEffect, useRef } from "react";
import { Shield, ExternalLink, AlertTriangle, Loader2 } from "lucide-react";
import { ContractInput } from "./components/ContractInput";
import { PaymentFlow } from "./components/PaymentFlow";
import { FindingsList } from "./components/FindingsList";
import { runDemoAudit } from "./api";
import type { PageState, AuditStep, PaymentAsset } from "./types";

const DEMO_CONTRACT = `// ⚠️ INTENTIONALLY VULNERABLE — for audit testing only
use soroban_sdk::{contract, contractimpl, contracttype, token, Address, Env, Vec};

#[contracttype]
pub enum DataKey { Balance, Owner, Depositors }

#[contract]
pub struct Vault;

#[contractimpl]
impl Vault {
    pub fn init(env: Env, owner: Address) {
        owner.require_auth();
        env.storage().instance().set(&DataKey::Owner, &owner);
        env.storage().instance().set(&DataKey::Balance, &0_i128);
        env.storage().instance().set(&DataKey::Depositors, &Vec::<Address>::new(&env));
    }

    pub fn deposit(env: Env, from: Address, token_address: Address, amount: i128) {
        from.require_auth();
        // ⚠️ Unchecked arithmetic — silent overflow
        let current: i128 = env.storage().instance().get(&DataKey::Balance).unwrap_or(0);
        env.storage().instance().set(&DataKey::Balance, &(current + amount));
        // ⚠️ Unbounded Vec in Instance storage — DoS
        let mut deps: Vec<Address> = env.storage().instance()
            .get(&DataKey::Depositors).unwrap_or(Vec::new(&env));
        deps.push_back(from.clone());
        env.storage().instance().set(&DataKey::Depositors, &deps);
        token::Client::new(&env, &token_address)
            .transfer_from(&env.current_contract_address(), &from, &env.current_contract_address(), &amount);
    }

    // ⚠️ Missing require_auth — anyone can drain the vault!
    pub fn withdraw(env: Env, to: Address, token_address: Address, amount: i128) {
        let current: i128 = env.storage().instance().get(&DataKey::Balance).unwrap_or(0);
        env.storage().instance().set(&DataKey::Balance, &(current - amount));
        token::Client::new(&env, &token_address)
            .transfer(&env.current_contract_address(), &to, &amount);
    }

    pub fn balance(env: Env) -> i128 {
        env.storage().instance().get(&DataKey::Balance).unwrap_or(0)
    }
}`;

// UX step timing (cosmetic — real ops run in parallel server-side)
const STEP_DELAYS: [AuditStep, number][] = [
  [0, 0],
  [1, 1800],
  [2, 4000],
];

const PRICES: Record<PaymentAsset, string> = {
  USDC: "0.15 USDC",
  XLM: "1 XLM",
};

export default function App() {
  const [code, setCode] = useState(DEMO_CONTRACT);
  const [state, setState] = useState<PageState>({ status: "idle" });
  const [asset, setAsset] = useState<PaymentAsset>("USDC");
  const stepTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

  function clearTimers() {
    stepTimers.current.forEach(clearTimeout);
    stepTimers.current = [];
  }

  useEffect(() => () => clearTimers(), []);

  async function handleAudit() {
    if (!code.trim()) return;
    clearTimers();

    // Kick off UX step animation
    setState({ status: "loading", step: 0, asset });

    for (const [step, delay] of STEP_DELAYS) {
      if (delay === 0) continue;
      const t = setTimeout(
        () => setState((s) => s.status === "loading" ? { status: "loading", step, asset } : s),
        delay,
      );
      stepTimers.current.push(t);
    }

    try {
      const result = await runDemoAudit(code, asset);
      clearTimers();
      setState({ status: "success", result });
    } catch (err) {
      clearTimers();
      setState({
        status: "error",
        message: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  const isLoading = state.status === "loading";

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-mono">
      {/* Header */}
      <header className="border-b border-gray-800 bg-gray-900/50 backdrop-blur sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-green-500/10 border border-green-800">
              <Shield size={16} className="text-green-400" />
            </div>
            <div>
              <h1 className="text-sm font-semibold text-white tracking-wide">
                SOROBAN SECURITY AUDITOR
              </h1>
              <p className="text-xs text-gray-500">
                Automated vulnerability detection · x402 · Stellar Testnet
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-yellow-500 bg-yellow-500/10 border border-yellow-800 px-2 py-0.5 rounded">
              TESTNET
            </span>
            <span className="text-xs text-gray-500">{PRICES[asset]} / audit</span>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="max-w-7xl mx-auto px-4 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left: Input */}
          <div className="flex flex-col gap-4">
            <ContractInput value={code} onChange={setCode} disabled={isLoading} />

            {/* Payment asset toggle */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500 mr-1">Pay with:</span>
              {(["USDC", "XLM"] as PaymentAsset[]).map((a) => (
                <button
                  key={a}
                  onClick={() => setAsset(a)}
                  disabled={isLoading}
                  className={`px-3 py-1 rounded text-xs font-semibold border transition-colors disabled:cursor-not-allowed
                    ${
                      asset === a
                        ? "bg-green-600 border-green-500 text-white"
                        : "bg-gray-900 border-gray-700 text-gray-400 hover:border-green-700 hover:text-green-400"
                    }`}
                >
                  {a === "USDC" ? "0.15 USDC" : "1 XLM"}
                </button>
              ))}
              {asset === "XLM" && (
                <span className="text-xs text-gray-600 ml-1">· no trustline needed</span>
              )}
            </div>

            <button
              onClick={handleAudit}
              disabled={isLoading || !code.trim()}
              className="w-full flex items-center justify-center gap-2 rounded-lg bg-green-600 hover:bg-green-500 disabled:bg-gray-800 disabled:text-gray-600 disabled:cursor-not-allowed text-white font-semibold py-3 text-sm transition-colors"
            >
              {isLoading ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Auditing...
                </>
              ) : (
                <>
                  <Shield size={16} />
                  Audit Contract — {PRICES[asset]}
                </>
              )}
            </button>

            {/* How it works */}
            <div className="rounded-lg border border-gray-800 bg-gray-900/50 p-4 text-xs text-gray-500 leading-relaxed">
              <p className="text-gray-400 font-semibold mb-2">How it works</p>
              <ol className="list-decimal list-inside space-y-1">
                <li>Your contract code is sent to the audit gateway</li>
                <li>
                  <span className="text-green-500">{PRICES[asset]}</span> is paid on Stellar
                  Testnet via the{" "}
                  <a
                    href="https://x402.org"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-green-500 hover:underline"
                  >
                    x402 protocol
                  </a>
                  {asset === "XLM" && (
                    <span className="text-gray-600"> (native XLM — no trustline required)</span>
                  )}
                </li>
                <li>
                  Two-pass AI analysis checks{" "}
                  <span className="text-green-500">S001–S012 vulnerability classes</span>,
                  CVEs, and OpenZeppelin audit findings
                </li>
                <li>Structured report with severity, confidence, CWE IDs, and fixes</li>
              </ol>
            </div>
          </div>

          {/* Right: Results */}
          <div className="flex flex-col gap-4">
            {state.status === "idle" && (
              <div className="rounded-lg border border-gray-800 bg-gray-900/30 h-48 flex items-center justify-center">
                <p className="text-gray-700 text-sm">Audit results will appear here</p>
              </div>
            )}

            {state.status === "loading" && (
              <PaymentFlow step={state.step} asset={state.asset} />
            )}

            {state.status === "error" && (
              <div className="rounded-lg border border-red-800 bg-red-950/30 p-4 flex gap-3">
                <AlertTriangle size={16} className="text-red-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-red-400 mb-1">Audit Failed</p>
                  <p className="text-xs text-gray-400">{state.message}</p>
                </div>
              </div>
            )}

            {state.status === "success" && (
              <>
                {/* Payment proof */}
                <a
                  href={state.result.explorerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between rounded-lg border border-green-800 bg-green-950/30 px-4 py-3 hover:bg-green-950/50 transition-colors group"
                >
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                    <span className="text-xs text-green-400 font-medium">
                      Payment confirmed on Stellar Testnet
                      <span className="text-gray-500 ml-1">
                        ({PRICES[state.result.asset]})
                      </span>
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-gray-500 group-hover:text-green-400 transition-colors">
                    <span className="font-mono">
                      {state.result.txHash.slice(0, 8)}…{state.result.txHash.slice(-6)}
                    </span>
                    <ExternalLink size={11} />
                  </div>
                </a>

                <FindingsList
                  findings={state.result.findings}
                  model={state.result.model}
                />
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
