import React, { useState, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Alert,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import Colors from "@/constants/colors";
import { useApp } from "@/context/AppContext";

const GOLD = Colors.gold;

const SECTORS = [
  { id: "retail", label: "Retail", icon: "shopping-bag" as const },
  { id: "hospitality", label: "Hospitality", icon: "coffee" as const },
  { id: "professional_services", label: "Professional Services", icon: "briefcase" as const },
  { id: "construction", label: "Construction", icon: "tool" as const },
  { id: "healthcare", label: "Healthcare", icon: "heart" as const },
  { id: "technology", label: "Technology", icon: "cpu" as const },
  { id: "finance", label: "Finance", icon: "trending-up" as const },
  { id: "education", label: "Education", icon: "book" as const },
  { id: "other", label: "Other", icon: "grid" as const },
];

type Step = "welcome" | "business" | "email" | "email_otp" | "api_key" | "done";

export default function OnboardingScreen() {
  const { token, completeOnboarding } = useApp();
  const router = useRouter();
  const [step, setStep] = useState<Step>("welcome");
  const [businessName, setBusinessName] = useState("");
  const [selectedSector, setSelectedSector] = useState("");
  const [email, setEmail] = useState("");
  const [otpDigits, setOtpDigits] = useState(["", "", "", "", "", ""]);
  const [apiKey, setApiKey] = useState("");
  const [selectedProvider, setSelectedProvider] = useState<"openai" | "anthropic">("openai");
  const [isLoading, setIsLoading] = useState(false);
  const otpRefs = useRef<(TextInput | null)[]>([]);

  const apiBase = `https://${process.env["EXPO_PUBLIC_DOMAIN"]}/api`;
  const headers = { Authorization: `Bearer ${token ?? ""}`, "Content-Type": "application/json" };

  const createBusiness = async () => {
    if (!businessName.trim()) return false;
    setIsLoading(true);
    try {
      const resp = await fetch(`${apiBase}/businesses`, {
        method: "POST",
        headers,
        body: JSON.stringify({ name: businessName, sector: selectedSector, isActive: true }),
      });
      return resp.ok;
    } catch {
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  const saveApiKey = async () => {
    if (!apiKey.trim()) return true;
    setIsLoading(true);
    try {
      const resp = await fetch(`${apiBase}/keys`, {
        method: "POST",
        headers,
        body: JSON.stringify({ provider: selectedProvider, key: apiKey.trim() }),
      });
      return resp.ok;
    } catch {
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  const requestEmailOtp = async () => {
    setIsLoading(true);
    try {
      const resp = await fetch(`${apiBase}/auth/email/request-otp`, {
        method: "POST",
        headers,
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = await resp.json();
      if (resp.ok) {
        setStep("email_otp");
      } else {
        Alert.alert("Error", data.error || "Failed to send verification code.");
      }
    } catch {
      Alert.alert("Error", "Network error. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const verifyEmailOtp = async () => {
    const code = otpDigits.join("");
    if (code.length !== 6) return;
    setIsLoading(true);
    try {
      const resp = await fetch(`${apiBase}/auth/email/verify-otp`, {
        method: "POST",
        headers,
        body: JSON.stringify({ email: email.trim(), code }),
      });
      const data = await resp.json();
      if (resp.ok && data.success) {
        setStep("api_key");
      } else {
        Alert.alert("Error", data.error || "Invalid verification code.");
      }
    } catch {
      Alert.alert("Error", "Network error. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleResendOtp = async () => {
    setIsLoading(true);
    try {
      await fetch(`${apiBase}/auth/email/request-otp`, {
        method: "POST",
        headers,
        body: JSON.stringify({ email: email.trim() }),
      });
      Alert.alert("Sent", "A new verification code has been sent.");
      setOtpDigits(["", "", "", "", "", ""]);
    } catch {
      Alert.alert("Error", "Failed to resend code.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleOtpChange = (index: number, value: string) => {
    if (value.length > 1) {
      const digits = value.replace(/[^0-9]/g, "").slice(0, 6).split("");
      const newOtp = [...otpDigits];
      digits.forEach((d, i) => {
        if (index + i < 6) newOtp[index + i] = d;
      });
      setOtpDigits(newOtp);
      const nextIdx = Math.min(index + digits.length, 5);
      otpRefs.current[nextIdx]?.focus();
      return;
    }
    const newOtp = [...otpDigits];
    newOtp[index] = value.replace(/[^0-9]/g, "");
    setOtpDigits(newOtp);
    if (value && index < 5) {
      otpRefs.current[index + 1]?.focus();
    }
  };

  const handleOtpKeyPress = (index: number, key: string) => {
    if (key === "Backspace" && !otpDigits[index] && index > 0) {
      otpRefs.current[index - 1]?.focus();
    }
  };

  const handleNext = async () => {
    if (step === "welcome") {
      setStep("business");
    } else if (step === "business") {
      if (!businessName.trim()) {
        Alert.alert("Required", "Please enter your business name.");
        return;
      }
      const ok = await createBusiness();
      if (!ok) {
        Alert.alert("Error", "Failed to create business. Please try again.");
        return;
      }
      setStep("email");
    } else if (step === "email") {
      if (email.trim()) {
        await requestEmailOtp();
      } else {
        setStep("api_key");
      }
    } else if (step === "email_otp") {
      await verifyEmailOtp();
    } else if (step === "api_key") {
      if (apiKey.trim()) {
        await saveApiKey();
      }
      setStep("done");
    } else if (step === "done") {
      await completeOnboarding();
      router.replace("/(tabs)");
    }
  };

  const renderStep = () => {
    switch (step) {
      case "welcome":
        return (
          <View style={styles.stepContent}>
            <View style={styles.logoContainer}>
              <Text style={styles.logo}>G</Text>
            </View>
            <Text style={styles.welcomeTitle}>Welcome to GoRigo</Text>
            <Text style={styles.welcomeSubtitle}>
              Your AI-powered business operating system. Automate operations, manage communications, and grow your business — all from your phone.
            </Text>

            <View style={styles.featureList}>
              {[
                { icon: "cpu" as const, label: "AI Agents that work for you" },
                { icon: "message-circle" as const, label: "Smart communications management" },
                { icon: "trending-up" as const, label: "Real-time business insights" },
                { icon: "lock" as const, label: "Bank-grade security encryption" },
              ].map((f) => (
                <View key={f.label} style={styles.featureItem}>
                  <View style={styles.featureIcon}>
                    <Feather name={f.icon} size={18} color={GOLD} />
                  </View>
                  <Text style={styles.featureLabel}>{f.label}</Text>
                </View>
              ))}
            </View>

            <TouchableOpacity
              style={styles.recoverLink}
              onPress={() => router.push("/recover-account")}
            >
              <Feather name="refresh-cw" size={14} color={GOLD} />
              <Text style={styles.recoverLinkText}>Recover an existing account</Text>
            </TouchableOpacity>
          </View>
        );

      case "business":
        return (
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : "height"}
            style={styles.stepContent}
          >
            <Text style={styles.stepTitle}>Tell us about your business</Text>
            <Text style={styles.stepSubtitle}>This helps GoRigo personalise AI recommendations for you.</Text>

            <Text style={styles.fieldLabel}>Business Name *</Text>
            <TextInput
              style={styles.textInput}
              value={businessName}
              onChangeText={setBusinessName}
              placeholder="e.g. Acme Ltd"
              placeholderTextColor="#555"
              autoFocus
            />

            <Text style={styles.fieldLabel}>Sector</Text>
            <View style={styles.sectorGrid}>
              {SECTORS.map((s) => (
                <TouchableOpacity
                  key={s.id}
                  style={[styles.sectorChip, selectedSector === s.id && styles.sectorChipActive]}
                  onPress={() => setSelectedSector(selectedSector === s.id ? "" : s.id)}
                >
                  <Feather
                    name={s.icon}
                    size={14}
                    color={selectedSector === s.id ? GOLD : "#8A8A8A"}
                  />
                  <Text
                    style={[
                      styles.sectorChipText,
                      selectedSector === s.id && styles.sectorChipTextActive,
                    ]}
                  >
                    {s.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </KeyboardAvoidingView>
        );

      case "email":
        return (
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : "height"}
            style={styles.stepContent}
          >
            <Text style={styles.stepTitle}>Add your email</Text>
            <Text style={styles.stepSubtitle}>
              Optional — allows you to recover your account if you switch devices.
            </Text>

            <Text style={styles.fieldLabel}>Email Address</Text>
            <TextInput
              style={styles.textInput}
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              placeholderTextColor="#555"
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
            />

            <View style={styles.securityNote}>
              <Feather name="shield" size={14} color={GOLD} />
              <Text style={styles.securityText}>
                Your email lets you recover your account and data on a new device. We'll never spam you.
              </Text>
            </View>

            <TouchableOpacity style={styles.skipLink} onPress={() => setStep("api_key")}>
              <Text style={styles.skipLinkText}>Skip for now</Text>
            </TouchableOpacity>
          </KeyboardAvoidingView>
        );

      case "email_otp":
        return (
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : "height"}
            style={styles.stepContent}
          >
            <Text style={styles.stepTitle}>Verify your email</Text>
            <Text style={styles.stepSubtitle}>
              We sent a 6-digit code to {email}. Enter it below.
            </Text>

            <View style={styles.otpRow}>
              {otpDigits.map((digit, i) => (
                <TextInput
                  key={i}
                  ref={(ref) => { otpRefs.current[i] = ref; }}
                  style={[styles.otpInput, digit && styles.otpInputFilled]}
                  value={digit}
                  onChangeText={(v) => handleOtpChange(i, v)}
                  onKeyPress={({ nativeEvent }) => handleOtpKeyPress(i, nativeEvent.key)}
                  keyboardType="number-pad"
                  maxLength={1}
                  textContentType="oneTimeCode"
                />
              ))}
            </View>

            <TouchableOpacity style={styles.resendBtn} onPress={handleResendOtp} disabled={isLoading}>
              <Text style={styles.resendText}>Didn't receive a code? Resend</Text>
            </TouchableOpacity>
          </KeyboardAvoidingView>
        );

      case "api_key":
        return (
          <View style={styles.stepContent}>
            <Text style={styles.stepTitle}>Connect your AI</Text>
            <Text style={styles.stepSubtitle}>
              Add your API key to enable AI features. You can also do this later in Settings.
            </Text>

            <View style={styles.providerRow}>
              {(["openai", "anthropic"] as const).map((p) => (
                <TouchableOpacity
                  key={p}
                  style={[styles.providerBtn, selectedProvider === p && styles.providerBtnActive]}
                  onPress={() => setSelectedProvider(p)}
                >
                  <Text style={[styles.providerBtnText, selectedProvider === p && styles.providerBtnTextActive]}>
                    {p === "openai" ? "OpenAI" : "Anthropic"}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <TextInput
              style={styles.textInput}
              value={apiKey}
              onChangeText={setApiKey}
              placeholder={selectedProvider === "openai" ? "sk-..." : "sk-ant-..."}
              placeholderTextColor="#555"
              secureTextEntry
              autoCapitalize="none"
            />

            <View style={styles.securityNote}>
              <Feather name="lock" size={14} color={GOLD} />
              <Text style={styles.securityText}>
                Encrypted with envelope encryption (per-record AES-256-GCM). Never stored in plaintext.
              </Text>
            </View>

            <TouchableOpacity style={styles.skipLink} onPress={() => setStep("done")}>
              <Text style={styles.skipLinkText}>Skip for now</Text>
            </TouchableOpacity>
          </View>
        );

      case "done":
        return (
          <View style={[styles.stepContent, { alignItems: "center" }]}>
            <View style={styles.doneIcon}>
              <Feather name="check" size={40} color={GOLD} />
            </View>
            <Text style={styles.stepTitle}>You're all set!</Text>
            <Text style={styles.stepSubtitle}>
              GoRigo is ready to help you run your business. Start by chatting with your AI assistant on the Dashboard.
            </Text>
          </View>
        );
    }
  };

  const steps: Step[] = ["welcome", "business", "email", "email_otp", "api_key", "done"];
  const visibleSteps: Step[] = ["welcome", "business", "email", "api_key", "done"];
  const currentDotIndex = step === "email_otp"
    ? visibleSteps.indexOf("email")
    : visibleSteps.indexOf(step);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <View style={styles.dotsRow}>
          {visibleSteps.map((s, i) => (
            <View key={s} style={[styles.dot, i === currentDotIndex && styles.dotActive]} />
          ))}
        </View>

        {renderStep()}
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity
          style={[
            styles.nextBtn,
            step === "business" && !businessName.trim() && styles.nextBtnDisabled,
            step === "email_otp" && otpDigits.join("").length !== 6 && styles.nextBtnDisabled,
          ]}
          onPress={handleNext}
          disabled={
            isLoading ||
            (step === "business" && !businessName.trim()) ||
            (step === "email_otp" && otpDigits.join("").length !== 6)
          }
          activeOpacity={0.85}
        >
          {isLoading ? (
            <ActivityIndicator color="#0A0A0A" />
          ) : (
            <>
              <Text style={styles.nextBtnText}>
                {step === "done"
                  ? "Go to Dashboard"
                  : step === "api_key"
                  ? apiKey.trim()
                    ? "Save & Continue"
                    : "Continue"
                  : step === "email"
                  ? email.trim()
                    ? "Verify Email"
                    : "Continue"
                  : step === "email_otp"
                  ? "Verify Code"
                  : "Continue"}
              </Text>
              <Feather name="arrow-right" size={18} color="#0A0A0A" />
            </>
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0A0A0A" },
  scroll: { flex: 1 },
  scrollContent: { flexGrow: 1, padding: 24 },
  dotsRow: {
    flexDirection: "row",
    gap: 6,
    marginBottom: 40,
    justifyContent: "center",
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#2A2A2A",
  },
  dotActive: {
    width: 24,
    backgroundColor: GOLD,
  },
  stepContent: { flex: 1, paddingTop: 8 },
  logoContainer: {
    width: 80,
    height: 80,
    borderRadius: 24,
    backgroundColor: GOLD,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 32,
    alignSelf: "center",
  },
  logo: {
    fontSize: 40,
    fontFamily: "Inter_700Bold",
    color: "#0A0A0A",
    lineHeight: 48,
  },
  welcomeTitle: {
    fontSize: 32,
    fontFamily: "Inter_700Bold",
    color: "#FFFFFF",
    textAlign: "center",
    marginBottom: 16,
    letterSpacing: -0.5,
  },
  welcomeSubtitle: {
    fontSize: 16,
    fontFamily: "Inter_400Regular",
    color: "#8A8A8A",
    textAlign: "center",
    lineHeight: 24,
    marginBottom: 40,
  },
  featureList: { gap: 16 },
  featureItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    backgroundColor: "#1A1A1A",
    borderColor: "#2A2A2A",
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
  },
  featureIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.goldMuted,
    justifyContent: "center",
    alignItems: "center",
  },
  featureLabel: { fontSize: 15, fontFamily: "Inter_500Medium", color: "#FFFFFF" },
  recoverLink: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 24,
    paddingVertical: 12,
  },
  recoverLinkText: { fontSize: 14, fontFamily: "Inter_500Medium", color: GOLD },
  stepTitle: {
    fontSize: 26,
    fontFamily: "Inter_700Bold",
    color: "#FFFFFF",
    marginBottom: 8,
    letterSpacing: -0.5,
    textAlign: "center",
  },
  stepSubtitle: {
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    color: "#8A8A8A",
    lineHeight: 22,
    marginBottom: 32,
    textAlign: "center",
  },
  fieldLabel: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    color: "#8A8A8A",
    marginBottom: 10,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  textInput: {
    backgroundColor: "#1A1A1A",
    borderColor: "#2A2A2A",
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    fontFamily: "Inter_400Regular",
    color: "#FFFFFF",
    marginBottom: 24,
  },
  otpRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 10,
    marginBottom: 24,
  },
  otpInput: {
    width: 48,
    height: 56,
    borderRadius: 12,
    backgroundColor: "#1A1A1A",
    borderColor: "#2A2A2A",
    borderWidth: 1,
    textAlign: "center",
    fontSize: 22,
    fontFamily: "Inter_700Bold",
    color: "#FFFFFF",
  },
  otpInputFilled: {
    borderColor: GOLD,
    backgroundColor: Colors.goldMuted,
  },
  resendBtn: { alignItems: "center", paddingVertical: 12 },
  resendText: { fontSize: 14, fontFamily: "Inter_400Regular", color: "#8A8A8A" },
  sectorGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  sectorChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#1A1A1A",
    borderColor: "#2A2A2A",
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  sectorChipActive: { borderColor: GOLD, backgroundColor: Colors.goldMuted },
  sectorChipText: { fontSize: 13, fontFamily: "Inter_500Medium", color: "#8A8A8A" },
  sectorChipTextActive: { color: GOLD },
  providerRow: { flexDirection: "row", gap: 8, marginBottom: 16 },
  providerBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: "#1A1A1A",
    borderColor: "#2A2A2A",
    borderWidth: 1,
    alignItems: "center",
  },
  providerBtnActive: { borderColor: GOLD, backgroundColor: Colors.goldMuted },
  providerBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#8A8A8A" },
  providerBtnTextActive: { color: GOLD },
  securityNote: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    backgroundColor: Colors.goldMuted,
    borderRadius: 12,
    padding: 14,
    marginBottom: 20,
  },
  securityText: {
    flex: 1,
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: "#8A8A8A",
    lineHeight: 19,
  },
  skipLink: { alignItems: "center", paddingVertical: 12 },
  skipLinkText: { fontSize: 14, fontFamily: "Inter_400Regular", color: "#555" },
  doneIcon: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: Colors.goldMuted,
    borderColor: GOLD,
    borderWidth: 2,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 32,
    alignSelf: "center",
  },
  footer: {
    padding: 20,
    borderTopColor: "#2A2A2A",
    borderTopWidth: StyleSheet.hairlineWidth,
    backgroundColor: "#0A0A0A",
  },
  nextBtn: {
    backgroundColor: GOLD,
    borderRadius: 16,
    paddingVertical: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  nextBtnDisabled: { opacity: 0.5 },
  nextBtnText: { fontSize: 17, fontFamily: "Inter_700Bold", color: "#0A0A0A" },
});
