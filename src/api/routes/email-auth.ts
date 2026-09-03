/**
 * Email OTP authentication routes (P1 + P5).
 *
 * POST /api/v1/auth/email/request  { email }        → issue + send a 6-digit code
 * POST /api/v1/auth/email/verify   { email, code }  → verify, resolve/create the
 *   CDP end user + server smart account, and issue a session token.
 *
 * @remarks CDP_EMAIL_DEV_MODE=true accepts the fixed code "000000" (and, with
 *   no CDP client, derives a deterministic dev address). Real mode stores the
 *   code (10-min TTL, 5 attempts) and emails it via Resend.
 */
import express from "express";
import crypto from "crypto";
import type { Request, Response } from "express";
import type { CdpClient } from "@coinbase/cdp-sdk";
import { sendError } from "../errors.ts";
import { validateBody } from "../validation.ts";
import { emailOtpRequestSchema, emailOtpVerifySchema } from "../schemas.ts";
import {
  emailOtpRequestRateLimit,
  emailOtpVerifyRateLimit,
} from "../rate-limiter.ts";
import {
  getCdpClient,
  resolveOrCreateEndUser,
  ensureSmartAccount,
} from "../cdp.ts";
import { sendOtpEmail } from "../email.ts";

const Router = express.Router;

const DEV_CODE = "000000";
const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;

interface OtpRecord {
  code: string;
  expiresAt: number;
  attempts: number;
}

const otpStore = new Map<string, OtpRecord>();

export function _resetOtpStoreForTesting(): void {
  otpStore.clear();
}

function isDevMode(): boolean {
  return process.env.CDP_EMAIL_DEV_MODE === "true";
}

function generateCode(): string {
  return String(crypto.randomInt(100000, 1000000));
}

/** Deterministic dev address for an email (0x + sha256). NOT a real keypair. */
function devAddressFor(email: string): string {
  return (
    "0x" +
    crypto
      .createHash("sha256")
      .update("arbesk-dev:" + email)
      .digest("hex")
      .slice(0, 40)
  );
}

export interface EmailAuthDeps {
  getCdpClientFn?: () => Promise<CdpClient | null>;
  sendEmail?: (email: string, code: string) => Promise<void>;
}

export default function emailAuthRoutes(deps: EmailAuthDeps = {}) {
  const getCdp = deps.getCdpClientFn ?? getCdpClient;
  const sendEmail = deps.sendEmail ?? sendOtpEmail;
  const router = Router();

  router.post(
    "/request",
    emailOtpRequestRateLimit,
    validateBody(emailOtpRequestSchema),
    async (req: Request, res: Response) => {
      const { email } = req.body;
      if (isDevMode()) {
        console.log("[EMAIL-AUTH] request (dev mode)");
        return res.json({ devMode: true, message: "Dev mode: enter code 000000" });
      }
      const code = generateCode();
      otpStore.set(email, { code, expiresAt: Date.now() + OTP_TTL_MS, attempts: 0 });
      try {
        await sendEmail(email, code);
        console.log("[EMAIL-AUTH] code sent");
        res.json({ sent: true });
      } catch (err) {
        const e = err as Error;
        if (e.message.includes("RESEND_API_KEY not configured")) {
          return sendError(
            res,
            503,
            "EMAIL_OTP_NOT_CONFIGURED",
            "Email OTP delivery is not configured yet. Set RESEND_API_KEY.",
          );
        }
        console.error("[EMAIL-AUTH] send failed:", e.message);
        sendError(res, 502, "EMAIL_SEND_FAILED", "Failed to send verification code");
      }
    },
  );

  router.post(
    "/verify",
    emailOtpVerifyRateLimit,
    validateBody(emailOtpVerifySchema),
    async (req: Request, res: Response) => {
      const { email, code } = req.body;
      try {
        if (isDevMode()) {
          if (code !== DEV_CODE) {
            return sendError(res, 400, "OTP_INVALID", "Invalid code.");
          }
        } else {
          const record = otpStore.get(email);
          if (!record || record.expiresAt < Date.now()) {
            return sendError(res, 400, "OTP_EXPIRED", "Code missing or expired. Request a new one.");
          }
          if (record.attempts >= OTP_MAX_ATTEMPTS) {
            otpStore.delete(email);
            return sendError(res, 400, "OTP_EXPIRED", "Too many attempts. Request a new one.");
          }
          record.attempts += 1;
          if (record.code !== code) {
            return sendError(res, 400, "OTP_INVALID", "Invalid code.");
          }
          otpStore.delete(email);
        }

        let address: string;
        let userId: string | null = null;
        const cdp = await getCdp();
        if (cdp) {
          if (!process.env.CDP_WALLET_SECRET) {
            return sendError(
              res,
              503,
              "CDP_WALLET_SECRET_NOT_CONFIGURED",
              "CDP_WALLET_SECRET is required to provision a wallet. Set it in .env and restart.",
            );
          }
          const { user } = await resolveOrCreateEndUser(cdp, email);
          userId = user.userId;
          address = await ensureSmartAccount(cdp, user);
        } else {
          address = devAddressFor(email);
        }

        const { createSession, sessions } = await import("../sessions.ts");
        const token = createSession(address, { userId, email, authMethod: "email" });
        const expiresAt = sessions.get(token)!.expiresAt;
        console.log("[EMAIL-AUTH] verified - address=" + address);
        res.status(201).json({ token, expiresAt, address, email });
      } catch (err) {
        const e = err as Error;
        console.error("[EMAIL-AUTH] verify error:", e.message);
        sendError(res, 502, "CDP_PROVISION_FAILED", "Wallet provisioning failed");
      }
    },
  );

  return router;
}
