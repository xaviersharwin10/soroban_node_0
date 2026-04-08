export type PaymentAsset = "USDC" | "XLM";

export interface AuditFinding {
  vulnerability_type: string;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO";
  confidence: number;
  affected_function: string;
  cwe_id: string;
  suggested_fix: string;
  references: string[];
}

export interface DemoAuditResponse {
  txHash: string;
  explorerUrl: string;
  findings: AuditFinding[];
  reasoning: string;
  model: string;
  asset: PaymentAsset;
}

export type AuditStep = 0 | 1 | 2;

export type PageState =
  | { status: "idle" }
  | { status: "loading"; step: AuditStep; asset: PaymentAsset }
  | { status: "success"; result: DemoAuditResponse }
  | { status: "error"; message: string };
