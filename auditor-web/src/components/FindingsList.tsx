import { ShieldCheck, ShieldAlert } from "lucide-react";
import type { AuditFinding } from "../types";
import { FindingCard } from "./FindingCard";

const SEVERITY_ORDER: AuditFinding["severity"][] = [
  "CRITICAL",
  "HIGH",
  "MEDIUM",
  "LOW",
  "INFO",
];

const SUMMARY_COLORS: Record<AuditFinding["severity"], string> = {
  CRITICAL: "text-red-400 bg-red-500/10 border-red-800",
  HIGH: "text-orange-400 bg-orange-500/10 border-orange-800",
  MEDIUM: "text-yellow-400 bg-yellow-500/10 border-yellow-800",
  LOW: "text-blue-400 bg-blue-500/10 border-blue-800",
  INFO: "text-gray-400 bg-gray-500/10 border-gray-700",
};

interface Props {
  findings: AuditFinding[];
  model: string;
}

export function FindingsList({ findings, model }: Props) {
  const sorted = [...findings].sort(
    (a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity),
  );

  const counts = SEVERITY_ORDER.reduce(
    (acc, s) => {
      acc[s] = findings.filter((f) => f.severity === s).length;
      return acc;
    },
    {} as Record<AuditFinding["severity"], number>,
  );

  const hasFindings = findings.length > 0;

  return (
    <div className="flex flex-col gap-4">
      {/* Summary bar */}
      <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div className="flex items-center gap-2">
            {hasFindings ? (
              <ShieldAlert size={16} className="text-red-400" />
            ) : (
              <ShieldCheck size={16} className="text-green-400" />
            )}
            <span className="text-sm font-semibold text-white">
              {hasFindings
                ? `${findings.length} vulnerabilit${findings.length === 1 ? "y" : "ies"} found`
                : "No vulnerabilities detected"}
            </span>
          </div>
          <span className="text-xs text-gray-600">Model: {model}</span>
        </div>

        {hasFindings && (
          <div className="flex gap-2 flex-wrap">
            {SEVERITY_ORDER.filter((s) => counts[s] > 0).map((s) => (
              <span
                key={s}
                className={`text-xs font-medium px-2 py-0.5 rounded border ${SUMMARY_COLORS[s]}`}
              >
                {counts[s]} {s}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Finding cards */}
      {sorted.map((finding, i) => (
        <FindingCard key={i} finding={finding} index={i} />
      ))}
    </div>
  );
}
