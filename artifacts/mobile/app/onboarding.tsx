import React, { useState, useRef, useEffect } from "react";
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
import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";
import Colors from "@/constants/colors";
import { useApp } from "@/context/AppContext";
import { useQueryClient } from "@tanstack/react-query";

const GOLD = Colors.gold;

const COUNTRIES = [
  { code: "GB", name: "United Kingdom" },
  { code: "US", name: "United States" },
  { code: "CA", name: "Canada" },
  { code: "AU", name: "Australia" },
  { code: "IE", name: "Ireland" },
  { code: "DE", name: "Germany" },
  { code: "FR", name: "France" },
  { code: "NL", name: "Netherlands" },
  { code: "SE", name: "Sweden" },
  { code: "NO", name: "Norway" },
  { code: "DK", name: "Denmark" },
  { code: "FI", name: "Finland" },
  { code: "ES", name: "Spain" },
  { code: "IT", name: "Italy" },
  { code: "PT", name: "Portugal" },
  { code: "CH", name: "Switzerland" },
  { code: "AT", name: "Austria" },
  { code: "BE", name: "Belgium" },
  { code: "PL", name: "Poland" },
  { code: "NG", name: "Nigeria" },
  { code: "ZA", name: "South Africa" },
  { code: "GH", name: "Ghana" },
  { code: "KE", name: "Kenya" },
  { code: "IN", name: "India" },
  { code: "SG", name: "Singapore" },
  { code: "NZ", name: "New Zealand" },
  { code: "AE", name: "United Arab Emirates" },
  { code: "BR", name: "Brazil" },
  { code: "MX", name: "Mexico" },
  { code: "JP", name: "Japan" },
  { code: "Other", name: "Other" },
];

const INTENT_OPTIONS = [
  { id: "grow_revenue", label: "Grow Revenue", icon: "trending-up" as const },
  { id: "find_customers", label: "Find Customers", icon: "users" as const },
  { id: "reduce_costs", label: "Reduce Costs", icon: "scissors" as const },
  { id: "launch_product", label: "Launch a Product", icon: "package" as const },
  { id: "improve_efficiency", label: "Improve Efficiency", icon: "zap" as const },
  { id: "attract_investment", label: "Attract Investment", icon: "dollar-sign" as const },
  { id: "other", label: "Other", icon: "grid" as const },
];

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

const TOC_TEXT = `Terms of Service & Privacy Policy

Last updated: January 2025

1. ACCEPTANCE OF TERMS
By using GoRigo, you agree to be bound by these Terms of Service. If you do not agree, please do not use the service.

2. DESCRIPTION OF SERVICE
GoRigo is an AI-powered business operating system that provides tools to help you manage and grow your business.

3. USER RESPONSIBILITIES
You are responsible for maintaining the confidentiality of your account and for all activities that occur under your account. You agree to use the service only for lawful business purposes.

4. AI-GENERATED CONTENT
GoRigo uses artificial intelligence to generate analysis and recommendations. These are for informational purposes only and do not constitute professional financial, legal, or business advice.

5. DATA COLLECTION & PRIVACY
We collect information you provide (name, email, business details) and usage data to improve our services. We do not sell your personal data to third parties.

6. DATA SECURITY
Your API keys and sensitive data are encrypted using AES-256-GCM encryption. We employ industry-standard security practices to protect your information.

7. INTELLECTUAL PROPERTY
You retain ownership of your business data. GoRigo retains ownership of the platform, AI models, and generated output that does not contain your confidential data.

8. LIMITATION OF LIABILITY
GoRigo is not liable for any indirect, incidental, or consequential damages arising from your use of the service.

9. CHANGES TO TERMS
We may update these terms periodically. Continued use of the service constitutes acceptance of updated terms.

10. CONTACT
For questions about these terms, contact support@gorigo.ai`;

type Step =
  | "welcome"
  | "name_email"
  | "toc"
  | "country"
  | "account_type"
  | "intent"
  | "background"
  | "business"
  | "done";

const STEP_ORDER: Step[] = [
  "welcome",
  "name_email",
  "toc",
  "country",
  "account_type",
  "intent",
  "background",
  "business",
  "done",
];

export default function OnboardingScreen() {
  const { token, authenticate, completeOnboarding, setActiveBusinessId, loginWithMicrosoft } = useApp();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>("welcome");
  const [msLoginLoading, setMsLoginLoading] = useState(false);

  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [tocAccepted, setTocAccepted] = useState(false);
  const [country, setCountry] = useState("GB");
  const [countrySearch, setCountrySearch] = useState("");
  const [accountType, setAccountType] = useState<"individual" | "company" | "">("");
  const [selectedIntents, setSelectedIntents] = useState<string[]>([]);
  const [background, setBackground] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [selectedSector, setSelectedSector] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [selectedProvider, setSelectedProvider] = useState<"openai" | "anthropic">("openai");

  const [isLoading, setIsLoading] = useState(false);

  const apiBase = `https://${process.env["EXPO_PUBLIC_DOMAIN"]}/api`;

  // Always track the latest token via ref so fetch closures never go stale
  const tokenRef = useRef(token);
  useEffect(() => { tokenRef.current = token; }, [token]);

  const handleMicrosoftAdminLogin = async () => {
    if (msLoginLoading) return;
    setMsLoginLoading(true);
    try {
      const apiBase = `https://${process.env["EXPO_PUBLIC_DOMAIN"]}/api`;

      const redirectUri = Linking.createURL("auth/microsoft/callback");

      const resp = await fetch(`${apiBase}/auth/microsoft/redirect?redirectUri=${encodeURIComponent(redirectUri)}`);
      if (!resp.ok) {
        Alert.alert("Admin Login", "Microsoft login is not configured on this server.");
        return;
      }
      const { url, state } = await resp.json() as { url: string; state: string };
      const result = await WebBrowser.openAuthSessionAsync(url, redirectUri);

      if (result.type !== "success") {
        return;
      }

      const parsed = Linking.parse(result.url);
      const code = parsed.queryParams?.["code"] as string | undefined;
      const returnedState = parsed.queryParams?.["state"] as string | undefined;

      if (!code || !returnedState) {
        Alert.alert("Admin Login", "Login was cancelled or failed.");
        return;
      }

      const loginResult = await loginWithMicrosoft(code, returnedState, redirectUri);
      if (!loginResult.success) {
        Alert.alert("Admin Login Failed", loginResult.error ?? "Microsoft authentication failed.");
        return;
      }

      router.replace("/(tabs)");
    } catch (err) {
      Alert.alert("Admin Login", "An unexpected error occurred. Please try again.");
    } finally {
      setMsLoginLoading(false);
    }
  };

  const makeAuthHeaders = () => ({
    Authorization: `Bearer ${tokenRef.current ?? ""}`,
    "Content-Type": "application/json",
  });

  // Ensure we have a valid token before making auth-required API calls.
  // If token is null (e.g. auth hasn't resolved yet), attempt re-auth first.
  const ensureToken = async (): Promise<boolean> => {
    if (tokenRef.current) return true;
    await authenticate();
    // Give React one tick to propagate the new token into the ref
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
    return !!tokenRef.current;
  };

  const saveProfile = async () => {
    try {
      await fetch(`${apiBase}/profile`, {
        method: "PUT",
        headers: makeAuthHeaders(),
        body: JSON.stringify({
          displayName: displayName.trim() || undefined,
          email: email.trim() || undefined,
          country: country || undefined,
          accountType: accountType || undefined,
          intent: selectedIntents.join(",") || undefined,
          background: background.trim() || undefined,
          tocAcceptedAt: tocAccepted ? new Date().toISOString() : undefined,
        }),
      });
    } catch {
    }
  };

  const createBusiness = async () => {
    if (!businessName.trim()) return false;
    setIsLoading(true);
    try {
      const resp = await fetch(`${apiBase}/businesses`, {
        method: "POST",
        headers: makeAuthHeaders(),
        body: JSON.stringify({
          name: businessName.trim(),
          sector: selectedSector || undefined,
          country: country || "GB",
          isActive: true,
          accountType: accountType || undefined,
          intent: selectedIntents.join(",") || undefined,
          background: background.trim() || undefined,
        }),
      });
      if (!resp.ok) return false;
      const data = await resp.json() as { id: string };
      if (data.id) {
        await setActiveBusinessId(data.id);
        queryClient.invalidateQueries();
      }
      return true;
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
        headers: makeAuthHeaders(),
        body: JSON.stringify({ provider: selectedProvider, key: apiKey.trim() }),
      });
      return resp.ok;
    } catch {
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  const toggleIntent = (id: string) => {
    setSelectedIntents((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id],
    );
  };

  const filteredCountries = COUNTRIES.filter((c) =>
    c.name.toLowerCase().includes(countrySearch.toLowerCase()),
  );

  const currentIndex = STEP_ORDER.indexOf(step);

  const saveProfilePartial = async (data: Record<string, unknown>): Promise<boolean> => {
    try {
      const resp = await fetch(`${apiBase}/profile`, {
        method: "PUT",
        headers: makeAuthHeaders(),
        body: JSON.stringify(data),
      });
      return resp.ok;
    } catch {
      return false;
    }
  };

  const handleNext = async () => {
    if (step === "welcome") {
      setStep("name_email");
    } else if (step === "name_email") {
      if (displayName.trim() || email.trim()) {
        void saveProfilePartial({
          displayName: displayName.trim() || undefined,
          email: email.trim() || undefined,
        });
      }
      setStep("toc");
    } else if (step === "toc") {
      if (!tocAccepted) {
        Alert.alert("Required", "Please accept the Terms of Service to continue.");
        return;
      }
      setIsLoading(true);
      try {
        const hasToken = await ensureToken();
        if (!hasToken) {
          Alert.alert("Error", "Unable to authenticate. Please restart the app and try again.");
          return;
        }
        const ok = await saveProfilePartial({ tocAcceptedAt: new Date().toISOString() });
        if (!ok) {
          Alert.alert("Error", "Failed to record ToC acceptance. Please try again.");
          return;
        }
      } finally {
        setIsLoading(false);
      }
      setStep("country");
    } else if (step === "country") {
      void saveProfilePartial({ country });
      setStep("account_type");
    } else if (step === "account_type") {
      if (!accountType) {
        Alert.alert("Required", "Please select Individual or Company.");
        return;
      }
      void saveProfilePartial({ accountType });
      setStep("intent");
    } else if (step === "intent") {
      if (selectedIntents.length === 0) {
        Alert.alert("Required", "Please select at least one goal.");
        return;
      }
      void saveProfilePartial({ intent: selectedIntents.join(",") });
      setStep("background");
    } else if (step === "background") {
      if (background.trim()) {
        void saveProfilePartial({ background: background.trim() });
      }
      setStep("business");
    } else if (step === "business") {
      if (!businessName.trim()) {
        Alert.alert("Required", "Please enter your business name.");
        return;
      }
      setIsLoading(true);
      try {
        const [bizOk] = await Promise.all([
          createBusiness(),
          saveProfile(),
          apiKey.trim() ? saveApiKey() : Promise.resolve(true),
        ]);
        if (!bizOk) {
          Alert.alert("Error", "Failed to create business. Please try again.");
          return;
        }
      } finally {
        setIsLoading(false);
      }
      setStep("done");
    } else if (step === "done") {
      await completeOnboarding();
      router.replace("/(tabs)");
    }
  };

  const handleBack = () => {
    const idx = STEP_ORDER.indexOf(step);
    if (idx > 0) {
      setStep(STEP_ORDER[idx - 1]!);
    }
  };

  const isNextDisabled = () => {
    if (isLoading) return true;
    if (step === "toc") return !tocAccepted;
    if (step === "account_type") return !accountType;
    if (step === "intent") return selectedIntents.length === 0;
    if (step === "business") return !businessName.trim();
    return false;
  };

  const getNextLabel = () => {
    if (step === "done") return "Go to Dashboard";
    if (step === "business") return "Finish Setup";
    return "Continue";
  };

  const renderStep = () => {
    switch (step) {
      case "welcome":
        return (
          <View style={styles.stepContent}>
            <TouchableOpacity
              style={styles.logoContainer}
              onLongPress={handleMicrosoftAdminLogin}
              delayLongPress={2000}
              activeOpacity={1}
            >
              {msLoginLoading ? (
                <ActivityIndicator color="#0A0A0A" size="small" />
              ) : (
                <Text style={styles.logo}>G</Text>
              )}
            </TouchableOpacity>
            <Text style={styles.welcomeTitle}>Welcome to GoRigo</Text>
            <Text style={styles.welcomeSubtitle}>
              Your AI-powered business operating system. Let's set up your personalised experience.
            </Text>
            <View style={styles.featureList}>
              {[
                { icon: "cpu" as const, label: "AI strategies built for your business" },
                { icon: "message-circle" as const, label: "Smart communications management" },
                { icon: "target" as const, label: "Framework-driven strategic analysis" },
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

      case "name_email":
        return (
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.stepContent}>
            <Text style={styles.stepTitle}>Who are you?</Text>
            <Text style={styles.stepSubtitle}>
              This helps Rigo AI personalise everything for you.
            </Text>
            <Text style={styles.fieldLabel}>Your Name</Text>
            <TextInput
              style={styles.textInput}
              value={displayName}
              onChangeText={setDisplayName}
              placeholder="e.g. Jane Smith"
              placeholderTextColor="#555"
              autoFocus
            />
            <Text style={styles.fieldLabel}>Email Address (Optional)</Text>
            <TextInput
              style={styles.textInput}
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              placeholderTextColor="#555"
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />
            <View style={styles.securityNote}>
              <Feather name="shield" size={14} color={GOLD} />
              <Text style={styles.securityText}>
                Email allows you to recover your account on a new device. We'll never spam you.
              </Text>
            </View>
          </KeyboardAvoidingView>
        );

      case "toc":
        return (
          <View style={styles.stepContent}>
            <Text style={styles.stepTitle}>Terms & Privacy</Text>
            <Text style={styles.stepSubtitle}>
              Please read and accept before continuing.
            </Text>
            <ScrollView style={styles.tocScroll} showsVerticalScrollIndicator>
              <Text style={styles.tocText}>{TOC_TEXT}</Text>
            </ScrollView>
            <TouchableOpacity
              style={styles.checkboxRow}
              onPress={() => setTocAccepted((v) => !v)}
              activeOpacity={0.7}
            >
              <View style={[styles.checkbox, tocAccepted && styles.checkboxChecked]}>
                {tocAccepted && <Feather name="check" size={14} color="#0A0A0A" />}
              </View>
              <Text style={styles.checkboxLabel}>
                I agree to the Terms of Service and Privacy Policy
              </Text>
            </TouchableOpacity>
          </View>
        );

      case "country":
        return (
          <View style={styles.stepContent}>
            <Text style={styles.stepTitle}>Where are you based?</Text>
            <Text style={styles.stepSubtitle}>
              Used to tailor strategies and recommendations for your market.
            </Text>
            <TextInput
              style={[styles.textInput, { marginBottom: 12 }]}
              value={countrySearch}
              onChangeText={setCountrySearch}
              placeholder="Search countries..."
              placeholderTextColor="#555"
            />
            <ScrollView style={styles.countryList} showsVerticalScrollIndicator>
              {filteredCountries.map((c) => (
                <TouchableOpacity
                  key={c.code}
                  style={[styles.countryItem, country === c.code && styles.countryItemActive]}
                  onPress={() => setCountry(c.code)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.countryName, country === c.code && styles.countryNameActive]}>
                    {c.name}
                  </Text>
                  {country === c.code && <Feather name="check" size={16} color={GOLD} />}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        );

      case "account_type":
        return (
          <View style={styles.stepContent}>
            <Text style={styles.stepTitle}>Individual or Company?</Text>
            <Text style={styles.stepSubtitle}>
              This helps shape your AI strategy analyses.
            </Text>
            <View style={styles.accountTypeRow}>
              <TouchableOpacity
                style={[styles.accountTypeCard, accountType === "individual" && styles.accountTypeCardActive]}
                onPress={() => setAccountType("individual")}
                activeOpacity={0.7}
              >
                <Feather name="user" size={32} color={accountType === "individual" ? GOLD : "#8A8A8A"} />
                <Text style={[styles.accountTypeLabel, accountType === "individual" && styles.accountTypeLabelActive]}>
                  Individual
                </Text>
                <Text style={styles.accountTypeDesc}>Freelancer, sole trader, or self-employed</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.accountTypeCard, accountType === "company" && styles.accountTypeCardActive]}
                onPress={() => setAccountType("company")}
                activeOpacity={0.7}
              >
                <Feather name="briefcase" size={32} color={accountType === "company" ? GOLD : "#8A8A8A"} />
                <Text style={[styles.accountTypeLabel, accountType === "company" && styles.accountTypeLabelActive]}>
                  Company
                </Text>
                <Text style={styles.accountTypeDesc}>Limited company, partnership, or organisation</Text>
              </TouchableOpacity>
            </View>
          </View>
        );

      case "intent":
        return (
          <View style={styles.stepContent}>
            <Text style={styles.stepTitle}>What are your goals?</Text>
            <Text style={styles.stepSubtitle}>
              Select all that apply — Rigo AI will focus its strategies on these.
            </Text>
            <View style={styles.chipGrid}>
              {INTENT_OPTIONS.map((opt) => (
                <TouchableOpacity
                  key={opt.id}
                  style={[styles.intentChip, selectedIntents.includes(opt.id) && styles.intentChipActive]}
                  onPress={() => toggleIntent(opt.id)}
                  activeOpacity={0.7}
                >
                  <Feather
                    name={opt.icon}
                    size={14}
                    color={selectedIntents.includes(opt.id) ? GOLD : "#8A8A8A"}
                  />
                  <Text style={[styles.intentChipText, selectedIntents.includes(opt.id) && styles.intentChipTextActive]}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        );

      case "background":
        return (
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.stepContent}>
            <Text style={styles.stepTitle}>Tell Rigo about your business</Text>
            <Text style={styles.stepSubtitle}>
              The more context you share, the more personalised your AI strategies will be.
            </Text>
            <Text style={styles.fieldLabel}>Business Background</Text>
            <TextInput
              style={[styles.textInput, styles.textArea]}
              value={background}
              onChangeText={setBackground}
              placeholder={`e.g. I run a 3-person bakery in London. We've been trading for 2 years and specialise in sourdough. Our main challenge is repeat customers and online visibility...`}
              placeholderTextColor="#555"
              multiline
              numberOfLines={6}
              textAlignVertical="top"
              autoFocus
            />
            <TouchableOpacity style={styles.skipLink} onPress={() => setStep("business")}>
              <Text style={styles.skipLinkText}>Skip for now</Text>
            </TouchableOpacity>
          </KeyboardAvoidingView>
        );

      case "business":
        return (
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.stepContent}>
            <Text style={styles.stepTitle}>Business Setup</Text>
            <Text style={styles.stepSubtitle}>
              Tell us about your business and optionally connect your AI.
            </Text>
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
            <View style={[styles.chipGrid, { marginBottom: 24 }]}>
              {SECTORS.map((s) => (
                <TouchableOpacity
                  key={s.id}
                  style={[styles.intentChip, selectedSector === s.id && styles.intentChipActive]}
                  onPress={() => setSelectedSector(selectedSector === s.id ? "" : s.id)}
                  activeOpacity={0.7}
                >
                  <Feather
                    name={s.icon}
                    size={14}
                    color={selectedSector === s.id ? GOLD : "#8A8A8A"}
                  />
                  <Text style={[styles.intentChipText, selectedSector === s.id && styles.intentChipTextActive]}>
                    {s.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={styles.fieldLabel}>Connect AI (Optional)</Text>
            <View style={styles.providerRow}>
              {(["openai", "anthropic"] as const).map((p) => (
                <TouchableOpacity
                  key={p}
                  style={[styles.providerBtn, selectedProvider === p && styles.providerBtnActive]}
                  onPress={() => setSelectedProvider(p)}
                  activeOpacity={0.7}
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
          </KeyboardAvoidingView>
        );

      case "done":
        return (
          <View style={[styles.stepContent, { alignItems: "center" }]}>
            <View style={styles.doneIcon}>
              <Feather name="check" size={40} color={GOLD} />
            </View>
            <Text style={styles.stepTitle}>You're all set!</Text>
            <Text style={styles.stepSubtitle}>
              GoRigo is ready to help you run and grow your business. Head to Strategies to generate your first AI analysis.
            </Text>
          </View>
        );
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.progressBar}>
        <View
          style={[
            styles.progressFill,
            { width: `${Math.round(((currentIndex + 1) / STEP_ORDER.length) * 100)}%` as "100%" },
          ]}
        />
      </View>

      <View style={styles.dotsRow}>
        {STEP_ORDER.map((s, i) => (
          <View key={s} style={[styles.dot, i === currentIndex && styles.dotActive]} />
        ))}
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {renderStep()}
      </ScrollView>

      <View style={styles.footer}>
        {step !== "welcome" && step !== "done" && (
          <TouchableOpacity style={styles.backBtn} onPress={handleBack}>
            <Feather name="arrow-left" size={18} color="#8A8A8A" />
            <Text style={styles.backBtnText}>Back</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={[styles.nextBtn, isNextDisabled() && styles.nextBtnDisabled]}
          onPress={handleNext}
          disabled={isNextDisabled()}
          activeOpacity={0.85}
        >
          {isLoading ? (
            <ActivityIndicator color="#0A0A0A" />
          ) : (
            <>
              <Text style={styles.nextBtnText}>{getNextLabel()}</Text>
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
  progressBar: {
    height: 3,
    backgroundColor: "#2A2A2A",
    marginHorizontal: 0,
  },
  progressFill: {
    height: 3,
    backgroundColor: GOLD,
    borderRadius: 2,
  },
  dotsRow: {
    flexDirection: "row",
    gap: 5,
    marginTop: 16,
    marginBottom: 8,
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#2A2A2A",
  },
  dotActive: {
    width: 20,
    backgroundColor: GOLD,
  },
  scroll: { flex: 1 },
  scrollContent: { flexGrow: 1, padding: 24, paddingTop: 16 },
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
  featureList: { gap: 12 },
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
    marginBottom: 28,
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
    marginBottom: 20,
  },
  textArea: {
    height: 160,
    textAlignVertical: "top",
  },
  tocScroll: {
    flex: 1,
    backgroundColor: "#1A1A1A",
    borderColor: "#2A2A2A",
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    maxHeight: 280,
  },
  tocText: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: "#8A8A8A",
    lineHeight: 20,
  },
  checkboxRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 8,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: "#2A2A2A",
    backgroundColor: "#1A1A1A",
    justifyContent: "center",
    alignItems: "center",
  },
  checkboxChecked: {
    backgroundColor: GOLD,
    borderColor: GOLD,
  },
  checkboxLabel: {
    flex: 1,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: "#FFFFFF",
    lineHeight: 20,
  },
  countryList: {
    flex: 1,
    maxHeight: 320,
  },
  countryItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 10,
    marginBottom: 2,
  },
  countryItemActive: {
    backgroundColor: Colors.goldMuted,
  },
  countryName: {
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    color: "#FFFFFF",
  },
  countryNameActive: {
    fontFamily: "Inter_600SemiBold",
    color: GOLD,
  },
  accountTypeRow: {
    flexDirection: "row",
    gap: 12,
    marginTop: 8,
  },
  accountTypeCard: {
    flex: 1,
    backgroundColor: "#1A1A1A",
    borderColor: "#2A2A2A",
    borderWidth: 1,
    borderRadius: 16,
    padding: 20,
    alignItems: "center",
    gap: 10,
  },
  accountTypeCardActive: {
    borderColor: GOLD,
    backgroundColor: Colors.goldMuted,
  },
  accountTypeLabel: {
    fontSize: 16,
    fontFamily: "Inter_700Bold",
    color: "#FFFFFF",
  },
  accountTypeLabelActive: { color: GOLD },
  accountTypeDesc: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: "#8A8A8A",
    textAlign: "center",
    lineHeight: 16,
  },
  chipGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  intentChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#1A1A1A",
    borderColor: "#2A2A2A",
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  intentChipActive: { borderColor: GOLD, backgroundColor: Colors.goldMuted },
  intentChipText: { fontSize: 13, fontFamily: "Inter_500Medium", color: "#8A8A8A" },
  intentChipTextActive: { color: GOLD },
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
    gap: 10,
  },
  backBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
  },
  backBtnText: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
    color: "#8A8A8A",
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
