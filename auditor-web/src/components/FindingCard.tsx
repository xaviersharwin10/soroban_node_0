import { ExternalLink, Zap } from "lucide-react";
import type { AuditFinding } from "../types";

const SEVERITY_STYLES: Record<
  AuditFinding["severity"],
  { border: string; bg: string; badge: string; text: string }
> = {
  CRITICAL: {
    border: "border-red-600",
    bg: "bg-red-950/40",
    badge: "bg-red-600 text-white",
    text: "text-red-400",
  },
  HIGH: {
    border: "border-orange-500",
    bg: "bg-orange-950/40",
    badge: "bg-orange-500 text-white",
    text: "text-orange-400",
  },
  MEDIUM: {
    border: "border-yellow-500",
    bg: "bg-yellow-950/40",
    badge: "bg-yellow-500 text-black",
    text: "text-yellow-400",
  },
  LOW: {
    border: "border-blue-500",
    bg: "bg-blue-950/40",
    badge: "bg-blue-500 text-white",
    text: "text-blue-400",
  },
  INFO: {
    border: "border-gray-600",
    bg: "bg-gray-800/40",
    badge: "bg-gray-600 text-white",
    text: "text-gray-400",
  },
};

function confidenceColor(c: number) {
  if (c >= 90) return "text-green-400 bg-green-500/10";
  if (c >= 70) return "text-yellow-400 bg-yellow-500/10";
  return "text-orange-400 bg-orange-500/10";
}

function shortRef(url: string) {
  // e.g. ".../sanctifier/S001.md" → "S001"
  const match = url.match(/S\d{3}|GHSA-[A-Z0-9-]+/i);
  return match ? match[0].toUpperCase() : "REF";
}

interface Props {
  finding: AuditFinding;
  index: number;
}

export function FindingCard({ finding, index }: Props) {
  const s = SEVERITY_STYLES[finding.severity];

  return (
    <div
      className={`rounded-lg border ${s.border} ${s.bg} p-4 flex flex-col gap-3`}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-xs font-bold px-2 py-0.5 rounded ${s.badge}`}>
            {finding.severity}
          </span>
          <span className="text-sm font-semibold text-white">
            {finding.vulnerability_type}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">{finding.cwe_id}</span>
          <span
            className={`text-xs font-medium px-2 py-0.5 rounded ${confidenceColor(finding.confidence)}`}
          >
            {finding.confidence}% confidence
          </span>
        </div>
      </div>

      {/* Affected function */}
      <div className="flex items-center gap-2">
        <Zap size={12} className={s.text} />
        <span className="text-xs text-gray-400">Affected:</span>
        <code className={`text-xs font-mono ${s.text}`}>
          {finding.affected_function}
        </code>
      </div>

      {/* Fix */}
      <div className="rounded bg-gray-950/60 border border-gray-800 p-3">
        <p className="text-xs text-gray-500 mb-1 uppercase tracking-wider">Suggested Fix</p>
        <p className="text-sm text-gray-200 leading-relaxed">{finding.suggested_fix}</p>
      </div>

      {/* References */}
      {finding.references.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-gray-600">References:</span>
          {finding.references.map((url) => (
            <a
              key={url}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-xs text-gray-500 hover:text-green-400 transition-colors"
            >
              <ExternalLink size={10} />
              {shortRef(url)}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
