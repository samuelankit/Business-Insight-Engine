import { useState } from "react";
import { api, setToken } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { Loader2, Mail, ArrowLeft, Smartphone } from "lucide-react";

interface LoginPageProps {
  onLogin: () => void;
}

type Step = "email" | "otp";

export default function LoginPage({ onLogin }: LoginPageProps) {
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [otpAttempts, setOtpAttempts] = useState(0);

  async function handleRequestOtp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await api.auth.requestOtp(email.trim().toLowerCase());
      setStep("otp");
      setOtpAttempts(0);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to send code";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyOtp() {
    if (otp.length !== 6) return;
    setError(null);
    setLoading(true);
    try {
      const result = await api.auth.verifyOtp(email.trim().toLowerCase(), otp);
      if (result.success && result.token) {
        setToken(result.token);
        onLogin();
      }
    } catch (err: unknown) {
      const newAttempts = otpAttempts + 1;
      setOtpAttempts(newAttempts);
      setOtp("");

      if (newAttempts >= 2) {
        setError(
          "The code you entered is invalid or has expired. If you haven\u2019t linked this email address to your GoRigo account, please open the GoRigo mobile app and link your email first.",
        );
      } else {
        setError("Invalid or expired verification code. Please check and try again.");
      }
    } finally {
      setLoading(false);
    }
  }

  function handleBack() {
    setStep("email");
    setOtp("");
    setError(null);
    setOtpAttempts(0);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-primary/10 mb-4">
            <Mail className="w-6 h-6 text-primary" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">GoRigo Portal</h1>
          <p className="text-sm text-muted-foreground mt-1">Top up your wallet and view usage</p>
        </div>

        <Card>
          <CardHeader>
            {step === "email" ? (
              <>
                <CardTitle className="text-lg">Sign in with email</CardTitle>
                <CardDescription>
                  Enter the email address linked to your GoRigo account. You must have verified your email in the GoRigo mobile app first.
                </CardDescription>
              </>
            ) : (
              <>
                <CardTitle className="text-lg">Enter verification code</CardTitle>
                <CardDescription>
                  If <span className="font-medium text-foreground">{email}</span> is linked to a GoRigo account, a 6-digit code has been sent.
                </CardDescription>
              </>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {step === "email" ? (
              <form onSubmit={handleRequestOtp} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email">Email address</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoFocus
                  />
                </div>
                <Button type="submit" className="w-full" disabled={loading || !email.trim()}>
                  {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                  Send verification code
                </Button>
              </form>
            ) : (
              <div className="space-y-4">
                <div className="flex justify-center">
                  <InputOTP
                    maxLength={6}
                    value={otp}
                    onChange={setOtp}
                    onComplete={handleVerifyOtp}
                  >
                    <InputOTPGroup>
                      <InputOTPSlot index={0} />
                      <InputOTPSlot index={1} />
                      <InputOTPSlot index={2} />
                      <InputOTPSlot index={3} />
                      <InputOTPSlot index={4} />
                      <InputOTPSlot index={5} />
                    </InputOTPGroup>
                  </InputOTP>
                </div>
                <Button
                  className="w-full"
                  onClick={handleVerifyOtp}
                  disabled={loading || otp.length !== 6}
                >
                  {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                  Verify code
                </Button>

                <div className="rounded-lg bg-muted/50 border border-border p-3 flex gap-2.5 text-xs text-muted-foreground">
                  <Smartphone className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>
                    No code arrived? Make sure this email is linked and verified in the GoRigo mobile app under <strong>Settings &rsaquo; Account &rsaquo; Email</strong>.
                  </span>
                </div>

                <Button
                  variant="ghost"
                  className="w-full"
                  onClick={handleBack}
                  disabled={loading}
                >
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Try a different email
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground">
          Don&apos;t have a GoRigo account? Download the app to get started.
        </p>
      </div>
    </div>
  );
}
