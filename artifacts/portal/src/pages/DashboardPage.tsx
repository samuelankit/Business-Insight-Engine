import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/App";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Loader2,
  Wallet,
  TrendingUp,
  LogOut,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  ArrowUpRight,
  ArrowDownLeft,
  Zap,
} from "lucide-react";

interface WalletData {
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
}

interface Plan {
  id: string;
  name: string;
  eventsPerMonth: number;
  pricePencePerMonth: number;
  description: string;
}

interface Subscription {
  planId: string;
  status: string;
}

const PRESET_AMOUNTS = [2000, 5000, 10000, 20000];
const MIN_PENCE = 2000;
const MAX_PENCE = 50000;

function formatPence(pence: number): string {
  return `£${(pence / 100).toFixed(2)}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getBaseUrl(): string {
  return import.meta.env.BASE_URL.replace(/\/$/, "");
}

export default function DashboardPage() {
  const { logout } = useAuth();
  const [wallet, setWallet] = useState<WalletData | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [topupLoading, setTopupLoading] = useState(false);
  const [topupError, setTopupError] = useState<string | null>(null);
  const [selectedAmount, setSelectedAmount] = useState<number | null>(null);
  const [customAmount, setCustomAmount] = useState("");
  const [topupStatus, setTopupStatus] = useState<"success" | "cancelled" | null>(null);

  const loadData = useCallback(async () => {
    try {
      setError(null);
      const [walletData, plansData] = await Promise.all([
        api.usage.getWallet(),
        api.usage.getPlans(),
      ]);
      setWallet(walletData);
      setPlans(plansData);

      const summaryData = await api.usage.getSummary();
      setSubscription({ planId: summaryData.planId, status: summaryData.status });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to load data";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const topup = params.get("topup");
    if (topup === "success") {
      setTopupStatus("success");
    } else if (topup === "cancelled") {
      setTopupStatus("cancelled");
    }
    if (topup) {
      const url = new URL(window.location.href);
      url.searchParams.delete("topup");
      window.history.replaceState({}, "", url.toString());
    }
    loadData();
  }, [loadData]);

  function getTopupAmount(): number | null {
    if (customAmount.trim()) {
      const pounds = parseFloat(customAmount);
      if (!isNaN(pounds) && pounds > 0) {
        return Math.round(pounds * 100);
      }
      return null;
    }
    return selectedAmount;
  }

  async function handleTopup() {
    const amountPence = getTopupAmount();
    if (!amountPence) return;

    if (amountPence < MIN_PENCE) {
      setTopupError(`Minimum top-up is ${formatPence(MIN_PENCE)}`);
      return;
    }
    if (amountPence > MAX_PENCE) {
      setTopupError(`Maximum top-up is ${formatPence(MAX_PENCE)}`);
      return;
    }

    setTopupError(null);
    setTopupLoading(true);
    try {
      const baseUrl = getBaseUrl();
      const webReturnUrl = `${window.location.origin}${baseUrl}/`;
      const result = await api.payments.createTopupIntent(amountPence, webReturnUrl);
      if (result.checkoutUrl) {
        window.location.href = result.checkoutUrl;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to create payment";
      setTopupError(msg);
    } finally {
      setTopupLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const currentPlan = plans.find((p) => p.id === (subscription?.planId ?? "free")) ?? plans[0];

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-foreground">GoRigo Portal</h1>
            <p className="text-xs text-muted-foreground">Wallet &amp; Usage</p>
          </div>
          <Button variant="ghost" size="sm" onClick={logout}>
            <LogOut className="w-4 h-4 mr-2" />
            Sign out
          </Button>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 space-y-6">
        {topupStatus === "success" && (
          <Alert className="border-green-500/50 bg-green-500/10">
            <CheckCircle2 className="w-4 h-4 text-green-600" />
            <AlertDescription className="text-green-700 dark:text-green-400">
              Payment successful! Your wallet has been topped up. It may take a moment to reflect.
            </AlertDescription>
          </Alert>
        )}
        {topupStatus === "cancelled" && (
          <Alert>
            <XCircle className="w-4 h-4" />
            <AlertDescription>
              Payment was cancelled. Your wallet has not been charged.
            </AlertDescription>
          </Alert>
        )}

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <Wallet className="w-5 h-5 text-primary" />
              <CardTitle className="text-base">Wallet Balance</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex items-end gap-3">
              <span className="text-4xl font-bold text-foreground">
                {wallet?.balanceFormatted ?? "—"}
              </span>
              {wallet?.lowBalance && (
                <Badge variant="destructive" className="mb-1">
                  <AlertTriangle className="w-3 h-3 mr-1" />
                  Low balance
                </Badge>
              )}
            </div>
            {wallet?.lowBalance && (
              <p className="text-sm text-muted-foreground mt-2">
                Your balance is running low. Top up to continue using AI features.
              </p>
            )}
          </CardContent>
        </Card>

        {currentPlan && (
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-primary" />
                <CardTitle className="text-base">Current Plan</CardTitle>
              </div>
              <CardDescription>
                Plan upgrades are managed through the GoRigo mobile app.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between p-4 rounded-lg border border-border bg-primary/5">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <p className="text-base font-semibold text-foreground">{currentPlan.name}</p>
                    <Badge variant="outline" className="text-xs">
                      {subscription?.status ?? "active"}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    <Zap className="w-3.5 h-3.5" />
                    <span>
                      {currentPlan.eventsPerMonth === -1
                        ? "Unlimited AI events per month"
                        : `${currentPlan.eventsPerMonth} AI events per month`}
                    </span>
                  </div>
                </div>
                <p className="text-sm font-medium text-foreground">
                  {currentPlan.pricePencePerMonth === 0
                    ? "Free"
                    : formatPence(currentPlan.pricePencePerMonth) + "/mo"}
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Top Up Wallet</CardTitle>
            <CardDescription>
              Select an amount or enter a custom value (£20–£500). You&apos;ll be redirected to a secure Stripe checkout.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {topupError && (
              <Alert variant="destructive">
                <AlertDescription>{topupError}</AlertDescription>
              </Alert>
            )}

            <div className="grid grid-cols-4 gap-2">
              {PRESET_AMOUNTS.map((amount) => (
                <Button
                  key={amount}
                  variant={selectedAmount === amount && !customAmount ? "default" : "outline"}
                  className="w-full"
                  onClick={() => {
                    setSelectedAmount(amount);
                    setCustomAmount("");
                    setTopupError(null);
                  }}
                >
                  {formatPence(amount)}
                </Button>
              ))}
            </div>

            <div className="space-y-2">
              <Label htmlFor="customAmount">Custom amount (£)</Label>
              <Input
                id="customAmount"
                type="number"
                min="20"
                max="500"
                step="1"
                placeholder="e.g. 75"
                value={customAmount}
                onChange={(e) => {
                  setCustomAmount(e.target.value);
                  setSelectedAmount(null);
                  setTopupError(null);
                }}
              />
            </div>

            <Button
              className="w-full"
              onClick={handleTopup}
              disabled={topupLoading || (!selectedAmount && !customAmount.trim())}
            >
              {topupLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              {(() => {
                const amt = getTopupAmount();
                return amt ? `Top up ${formatPence(amt)}` : "Select an amount";
              })()}
            </Button>
          </CardContent>
        </Card>

        {wallet && wallet.recentTransactions.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Recent Transactions</CardTitle>
              <CardDescription>Last {wallet.recentTransactions.length} wallet activities</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-1">
                {wallet.recentTransactions.map((tx, i) => (
                  <div key={tx.id}>
                    {i > 0 && <Separator className="my-2" />}
                    <div className="flex items-center justify-between py-1">
                      <div className="flex items-center gap-3">
                        <div
                          className={`w-8 h-8 rounded-full flex items-center justify-center ${
                            tx.type === "credit"
                              ? "bg-green-500/10 text-green-600"
                              : "bg-red-500/10 text-red-600"
                          }`}
                        >
                          {tx.type === "credit" ? (
                            <ArrowUpRight className="w-4 h-4" />
                          ) : (
                            <ArrowDownLeft className="w-4 h-4" />
                          )}
                        </div>
                        <div>
                          <p className="text-sm font-medium text-foreground capitalize">
                            {tx.type === "credit" ? "Top-up" : "Usage"}
                          </p>
                          <p className="text-xs text-muted-foreground">{formatDate(tx.createdAt)}</p>
                        </div>
                      </div>
                      <span
                        className={`text-sm font-semibold ${
                          tx.type === "credit" ? "text-green-600" : "text-foreground"
                        }`}
                      >
                        {tx.type === "credit" ? "+" : "-"}{formatPence(tx.amountPence)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {wallet && wallet.recentTransactions.length === 0 && (
          <Card>
            <CardContent className="py-8 text-center">
              <p className="text-sm text-muted-foreground">No transactions yet. Top up your wallet to get started.</p>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
