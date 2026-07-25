"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  SESSION_COOKIE,
  createSessionToken,
  isPasswordValid,
  sessionCookieOptions,
} from "@/lib/session";

export type LoginState = { error?: string };

/**
 * Rejects absolute URLs and protocol-relative paths so a crafted `?next=`
 * parameter cannot turn the login form into an open redirect.
 */
function safeRedirectTarget(raw: FormDataEntryValue | null): string {
  if (typeof raw !== "string" || !raw.startsWith("/") || raw.startsWith("//")) {
    return "/";
  }
  return raw;
}

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const password = formData.get("password");

  if (typeof password !== "string" || password.length === 0) {
    return { error: "Enter your password." };
  }

  if (!process.env.APP_PASSWORD) {
    return { error: "APP_PASSWORD is not configured on the server." };
  }

  if (!isPasswordValid(password)) {
    // A deliberate delay to make online brute-forcing impractical. Per-IP
    // counters are unreliable across serverless invocations, so a fixed cost per
    // attempt is the honest mitigation available here.
    await new Promise((resolve) => setTimeout(resolve, 600));
    return { error: "Incorrect password." };
  }

  const store = await cookies();
  store.set(SESSION_COOKIE, createSessionToken(), sessionCookieOptions());

  redirect(safeRedirectTarget(formData.get("next")));
}

export async function logout(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  redirect("/login");
}
