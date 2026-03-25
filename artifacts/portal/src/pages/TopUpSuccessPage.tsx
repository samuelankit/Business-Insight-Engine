import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Loader2, Wallet } from "lucide-react";

const API_BASE = "/api";

export default function TopUpSuccessPage() {
  const params = new URLSearchParams(window.location.search);
  const userId = params.get("userId") ?? "";

  const [balanceFormatted, setBalanceFormatted] = useState<string | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(true);

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

  function handleDone() {
    try {
      window.close();
    } catch {
      // If window.close() doesn't work (not opened by script), redirect to portal
      const baseUrl = import.meta.env.BASE_URL.replace(/\/$/, "");
      window.location.href = `${baseUrl}/`;
    }
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="pb-3 text-center">
          <div className="flex justify-center mb-3">
            <div className="w-14 h-14 rounded-full bg-green-500/10 flex items-center justify-center">
              <CheckCircle2 className="w-8 h-8 text-green-600" />
            </div>
          </div>
          <CardTitle className="text-xl">Credits Added!</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5 text-center">
          <p className="text-muted-foreground text-sm">
            Your payment was successful and credits have been added to your wallet.
          </p>

          <div className="rounded-lg bg-muted/50 px-6 py-4">
            <div className="flex items-center justify-center gap-2 mb-1">
              <Wallet className="w-4 h-4 text-primary" />
              <span className="text-sm text-muted-foreground">New Balance</span>
            </div>
            {balanceLoading ? (
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground mx-auto mt-1" />
            ) : (
              <span className="text-3xl font-bold text-foreground">
                {balanceFormatted ?? "—"}
              </span>
            )}
          </div>

          <p className="text-xs text-muted-foreground">
            Your balance will update in the GoRigo app within a few seconds.
          </p>

          <Button className="w-full" onClick={handleDone}>
            Done
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
