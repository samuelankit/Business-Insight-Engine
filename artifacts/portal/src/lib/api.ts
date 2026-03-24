const BASE_URL = import.meta.env.BASE_URL.replace(/\/$/, "");

const API_BASE = "/api";

function getToken(): string | null {
  return localStorage.getItem("gorigo_portal_token");
}

function setToken(token: string): void {
  localStorage.setItem("gorigo_portal_token", token);
}

function clearToken(): void {
  localStorage.removeItem("gorigo_portal_token");
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  requiresAuth = true,
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (requiresAuth) {
    const token = getToken();
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
  }

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401) {
    clearToken();
    window.location.href = `${BASE_URL}/`;
    throw new Error("Unauthorized");
  }

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({ error: "Request failed" }));
    throw new Error(errorData.error || `HTTP ${res.status}`);
  }

  return res.json() as Promise<T>;
}

export const api = {
  auth: {
    requestOtp: (email: string) =>
      request<{ success: boolean; message: string }>(
        "POST",
        "/auth/email/recover-request",
        { email },
        false,
      ),
    verifyOtp: (email: string, code: string) =>
      request<{ success: boolean; userId: string; token: string }>(
        "POST",
        "/auth/email/recover-verify",
        {
          email,
          code,
          deviceId: `web-portal-${crypto.randomUUID()}`,
          platform: "web",
        },
        false,
      ),
  },
  usage: {
    getWallet: () =>
      request<{
        balancePence: number;
        balanceFormatted: string;
        lowBalance: boolean;
        recentTransactions: Array<{
          id: string;
          type: string;
          amountPence: number;
          description: string;
          createdAt: string;
        }>;
      }>("GET", "/usage/wallet"),
    getPlans: () =>
      request<
        Array<{
          id: string;
          name: string;
          eventsPerMonth: number;
          pricePencePerMonth: number;
          description: string;
        }>
      >("GET", "/usage/plans"),
    getSummary: () =>
      request<{
        planId: string;
        status: string;
        periodEnd: string | null;
      }>("GET", "/usage/subscription"),
  },
  payments: {
    createTopupIntent: (amountPence: number, webReturnUrl?: string) =>
      request<{ checkoutUrl: string; sessionId: string; amountPence: number }>(
        "POST",
        "/payments/topup/intent",
        { amountPence, webReturnUrl },
      ),
  },
};

export { getToken, setToken, clearToken };
