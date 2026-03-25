import { useState, useEffect, useCallback } from "react";
import { loadStripe, type Stripe as StripeType } from "@stripe/stripe-js";
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Loader2, Wallet, CheckCircle2, AlertTriangle, Zap } from "lucide-react";

const PACKAGES = [
  { id: "starter", name: "Starter", amountPence: 500, credits: 500, bonusLabel: null },
  { id: "standard", name: "Standard", amountPence: 1000, credits: 1100, bonusLabel: "10% bonus" },
  { id: "growth", name: "Growth", amountPence: 2500, credits: 3000, bonusLabel: "20% bonus" },
  { id: "pro", name: "Pro", amountPence: 5000, credits: 7000, bonusLabel: "40% bonus" },
] as const;

type PackageId = (typeof PACKAGES)[number]["id"];

const API_BASE = "/api";

function formatPence(pence: number): string {
  return `£${(pence / 100).toFixed(2)}`;
}

async function fetchStripePublishableKey(): Promise<string | null> {
  try {
    const res = await fetch(`${API_BASE}/wallet/config`);
    if (res.ok) {
      const data = await res.json() as { stripePublishableKey: string | null };
      return data.stripePublishableKey;
    }
  } catch {
    // ignore
  }
  const fromEnv = import.meta.env["VITE_STRIPE_PUBLISHABLE_KEY"] as string | undefined;
  return fromEnv ?? null;
}

interface CheckoutFormProps {
  userId: string;
  selectedPackage: (typeof PACKAGES)[number];
  clientSecret: string;
  onSuccess: () => void;
}

function CheckoutForm({ userId, selectedPackage, clientSecret: _clientSecret, onSuccess }: CheckoutFormProps) {
  const stripe = useStripe();
  const elements = useElements();
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);

  const baseUrl = import.meta.env.BASE_URL.replace(/\/$/, "");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;

    setPayError(null);
    setPaying(true);

    const returnUrl = `${window.location.origin}${baseUrl}/topup/success?userId=${encodeURIComponent(userId)}`;

    const { error } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: returnUrl },
    });

    if (error) {
      setPayError(error.message ?? "Payment failed. Please try again.");
      setPaying(false);
    } else {
      onSuccess();
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <PaymentElement />
      {payError && (
        <Alert variant="destructive">
          <AlertDescription>{payError}</AlertDescription>
        </Alert>
      )}
      <Button type="submit" className="w-full" disabled={!stripe || paying}>
        {paying ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
        Pay {formatPence(selectedPackage.amountPence)}
      </Button>
    </form>
  );
}

export default function TopUpPage() {
  const params = new URLSearchParams(window.location.search);
  const userId = params.get("userId") ?? "";

  const [balanceFormatted, setBalanceFormatted] = useState<string | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(true);
  const [selectedPackageId, setSelectedPackageId] = useState<PackageId | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [intentLoading, setIntentLoading] = useState(false);
  const [intentError, setIntentError] = useState<string | null>(null);
  const [stripePromise, setStripePromise] = useState<ReturnType<typeof loadStripe> | null>(null);
  const [stripeKeyMissing, setStripeKeyMissing] = useState(false);

  useEffect(() => {
    fetchStripePublishableKey().then((key) => {
      if (key) {
        setStripePromise(loadStripe(key));
      } else {
        setStripeKeyMissing(true);
      }
    });
  }, []);

  const fetchBalance = useCallback(async () => {
    if (!userId) {
      setBalanceLoading(false);
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/wallet/balance?userId=${encodeURIComponent(userId)}`);
      if (res.ok) {
        const data = await res.json() as { balanceFormatted: string };
        setBalanceFormatted(data.balanceFormatted);
      }
    } catch {
      // ignore
    } finally {
      setBalanceLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    fetchBalance();
  }, [fetchBalance]);

  async function selectPackage(packageId: PackageId) {
    setSelectedPackageId(packageId);
    setClientSecret(null);
    setIntentError(null);
    setIntentLoading(true);

    try {
      const res = await fetch(`${API_BASE}/wallet/topup/intent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, packageId }),
      });

      const data = await res.json() as { clientSecret?: string; error?: string };

      if (!res.ok) {
        setIntentError(data.error ?? "Failed to create payment intent");
        return;
      }

      setClientSecret(data.clientSecret ?? null);
    } catch {
      setIntentError("Network error. Please try again.");
    } finally {
      setIntentLoading(false);
    }
  }

  const selectedPackage = PACKAGES.find((p) => p.id === selectedPackageId) ?? null;

  if (!userId) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <Card className="w-full max-w-md">
          <CardContent className="py-8 text-center space-y-3">
            <AlertTriangle className="w-8 h-8 text-destructive mx-auto" />
            <p className="text-sm text-muted-foreground">
              Invalid link. Please open this page from the GoRigo app.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="max-w-lg mx-auto px-4 py-4">
          <h1 className="text-lg font-semibold text-foreground">Top Up Credits</h1>
          <p className="text-xs text-muted-foreground">GoRigo Wallet</p>
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 py-6 space-y-6">
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <Wallet className="w-5 h-5 text-primary" />
              <CardTitle className="text-base">Current Balance</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            {balanceLoading ? (
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            ) : (
              <span className="text-3xl font-bold text-foreground">
                {balanceFormatted ?? "—"}
              </span>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Choose a Package</CardTitle>
            <CardDescription>Select the amount of credits you&apos;d like to add.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3">
              {PACKAGES.map((pkg) => {
                const isSelected = selectedPackageId === pkg.id;
                return (
                  <button
                    key={pkg.id}
                    onClick={() => selectPackage(pkg.id)}
                    disabled={intentLoading}
                    className={`relative rounded-lg border-2 p-4 text-left transition-all focus:outline-none focus:ring-2 focus:ring-primary ${
                      isSelected
                        ? "border-primary bg-primary/5"
                        : "border-border bg-card hover:border-primary/40"
                    }`}
                  >
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold text-foreground">{pkg.name}</span>
                        {isSelected && <CheckCircle2 className="w-4 h-4 text-primary" />}
                      </div>
                      <span className="text-xl font-bold text-foreground">
                        {formatPence(pkg.amountPence)}
                      </span>
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Zap className="w-3 h-3" />
                        <span>{pkg.credits.toLocaleString()} credits</span>
                      </div>
                      {pkg.bonusLabel && (
                        <Badge variant="secondary" className="w-fit text-xs mt-1">
                          {pkg.bonusLabel}
                        </Badge>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {intentError && (
          <Alert variant="destructive">
            <AlertDescription>{intentError}</AlertDescription>
          </Alert>
        )}

        {intentLoading && (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {stripeKeyMissing && selectedPackage && (
          <Alert variant="destructive">
            <AlertDescription>
              Payment system is not fully configured. Please contact support.
            </AlertDescription>
          </Alert>
        )}

        {clientSecret && selectedPackage && stripePromise && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Payment Details</CardTitle>
              <CardDescription>
                You&apos;re adding {selectedPackage.credits.toLocaleString()} credits for {formatPence(selectedPackage.amountPence)}.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Elements
                stripe={stripePromise}
                options={{
                  clientSecret,
                  appearance: {
                    theme: "stripe",
                  },
                }}
              >
                <CheckoutForm
                  userId={userId}
                  selectedPackage={selectedPackage}
                  clientSecret={clientSecret}
                  onSuccess={() => {}}
                />
              </Elements>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
