/**
 * Email delivery (P5) — Resend HTTP API.
 * Config: RESEND_API_KEY (required), RESEND_FROM (optional, defaults to the
 * Resend onboarding address). Throws a RESEND_API_KEY message when unset so
 * the route can map it to a clear 503.
 */
export async function sendOtpEmail(email: string, code: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error("RESEND_API_KEY not configured");
  }
  const from = process.env.RESEND_FROM || "Arbesk <onboarding@resend.dev>";
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + apiKey,
    },
    body: JSON.stringify({
      from,
      to: [email],
      subject: "Your Arbesk verification code",
      text: "Your verification code is: " + code + ". It expires in 10 minutes.",
    }),
  });
  if (!res.ok) {
    throw new Error("Resend send failed: " + res.status + " " + (await res.text()));
  }
}
