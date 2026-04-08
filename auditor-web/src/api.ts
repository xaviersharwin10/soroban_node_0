import type { DemoAuditResponse, PaymentAsset } from "./types";

export async function runDemoAudit(
  code: string,
  asset: PaymentAsset = "USDC",
): Promise<DemoAuditResponse> {
  const res = await fetch("/api/audit/demo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, asset }),
  });

  const body = await res.json().catch(() => ({ error: "Invalid response from server" }));

  if (!res.ok) {
    throw new Error(
      (body as { detail?: string; error?: string }).detail ||
        (body as { error?: string }).error ||
        `Server error ${res.status}`,
    );
  }

  return body as DemoAuditResponse;
}
