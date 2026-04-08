import { Check, Loader2, Coins, LinkIcon, ShieldCheck } from "lucide-react";
import type { AuditStep, PaymentAsset } from "../types";

function getSteps(asset: PaymentAsset) {
  const price = asset === "XLM" ? "1 XLM" : "0.15 USDC";
  return [
    { label: "Sending Payment", sub: `${price} · Stellar Testnet`, Icon: Coins },
    { label: "Confirming On-Chain", sub: "Waiting for ledger close", Icon: LinkIcon },
    { label: "Running AI Audit", sub: "Two-pass vulnerability analysis", Icon: ShieldCheck },
  ] as const;
}

interface Props {
  step: AuditStep;
  asset: PaymentAsset;
}

export function PaymentFlow({ step, asset }: Props) {
  const STEPS = getSteps(asset);

  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900 p-5">
      <p className="text-xs text-gray-500 uppercase tracking-widest mb-4">Payment Flow</p>
      <div className="flex flex-col gap-4">
        {STEPS.map(({ label, sub, Icon }, i) => {
          const done = i < step;
          const active = i === step;
          const pending = i > step;

          return (
            <div key={i} className="flex items-center gap-3">
              {/* Step indicator */}
              <div
                className={`
                  flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center border
                  ${done ? "bg-green-500/20 border-green-500 text-green-400" : ""}
                  ${active ? "bg-green-500/10 border-green-600 text-green-400 animate-pulse" : ""}
                  ${pending ? "bg-gray-800 border-gray-700 text-gray-600" : ""}
                `}
              >
                {done ? (
                  <Check size={14} />
                ) : active ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Icon size={14} />
                )}
              </div>

              {/* Step text */}
              <div>
                <p
                  className={`text-sm font-medium ${
                    done
                      ? "text-green-400"
                      : active
                        ? "text-white"
                        : "text-gray-600"
                  }`}
                >
                  {label}
                </p>
                <p className={`text-xs ${active || done ? "text-gray-500" : "text-gray-700"}`}>
                  {sub}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
