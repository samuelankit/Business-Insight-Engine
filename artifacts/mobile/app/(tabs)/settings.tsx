import React, { useState, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Switch,
  Alert,
  Modal,
  ActivityIndicator,
  Linking,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import Colors from "@/constants/colors";
import { useApp } from "@/context/AppContext";
import { TopUpModal } from "@/components/TopUpModal";

const GOLD = Colors.gold;

export default function SettingsScreen() {
  const router = useRouter();
  const { token, userId, activeBusinessId, logout, isAdmin, adminEmail } = useApp();
  const queryClient = useQueryClient();
  const [showApiKey, setShowApiKey] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [selectedProvider, setSelectedProvider] = useState<"openai" | "anthropic">("openai");
  const [showBusinessModal, setShowBusinessModal] = useState(false);
  const [showTopUpModal, setShowTopUpModal] = useState(false);
  const [businessName, setBusinessName] = useState("");
  const [businessSector, setBusinessSector] = useState("");
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [emailInput, setEmailInput] = useState("");
  const [emailOtpDigits, setEmailOtpDigits] = useState(["", "", "", "", "", ""]);
  const [emailStep, setEmailStep] = useState<"input" | "otp">("input");
  const [emailLoading, setEmailLoading] = useState(false);
  const otpRefs = useRef<(TextInput | null)[]>([]);
  const [showFromEmailModal, setShowFromEmailModal] = useState(false);
  const [fromEmailInput, setFromEmailInput] = useState("");
  const [fromEmailSaving, setFromEmailSaving] = useState(false);
  const [verifyingSmtp, setVerifyingSmtp] = useState(false);
  const [smtpStatus, setSmtpStatus] = useState<{ verified: boolean; message: string } | null>(null);

  const apiBase = `https://${process.env["EXPO_PUBLIC_DOMAIN"]}/api`;
  const headers = { Authorization: `Bearer ${token ?? ""}`, "Content-Type": "application/json" };

  const { data: toolsList = [] } = useQuery<any[]>({
    queryKey: ["tools", userId],
    queryFn: async () => {
      const resp = await fetch(`${apiBase}/tools/available`, { headers });
      return resp.ok ? resp.json() : [];
    },
    enabled: !!token,
  });

  const connectedToolsCount = toolsList.filter((t: any) => t.isConnected).length;

  const { data: keys = [], refetch: refetchKeys } = useQuery<any[]>({
    queryKey: ["api-keys", userId],
    queryFn: async () => {
      const resp = await fetch(`${apiBase}/keys`, { headers });
      return resp.ok ? resp.json() : [];
    },
    enabled: !!token,
  });

  const { data: businesses = [] } = useQuery<any[]>({
    queryKey: ["businesses", userId],
    queryFn: async () => {
      const resp = await fetch(`${apiBase}/businesses`, { headers });
      return resp.ok ? resp.json() : [];
    },
    enabled: !!token,
  });

  const { data: walletData, refetch: refetchWallet } = useQuery<any>({
    queryKey: ["wallet", userId],
    queryFn: async () => {
      const resp = await fetch(`${apiBase}/usage/wallet`, { headers });
      return resp.ok ? resp.json() : null;
    },
    enabled: !!token,
    refetchInterval: 30000,
  });

  const { data: teamRole } = useQuery<any>({
    queryKey: ["team-role", activeBusinessId],
    queryFn: async () => {
      if (!activeBusinessId) return null;
      const resp = await fetch(`${apiBase}/team/role?businessId=${activeBusinessId}`, { headers });
      return resp.ok ? resp.json() : null;
    },
    enabled: !!token && !!activeBusinessId,
  });

  const { data: emailStatus, refetch: refetchEmail } = useQuery<{ email: string | null; emailVerified: boolean }>({
    queryKey: ["email-status", userId],
    queryFn: async () => {
      const resp = await fetch(`${apiBase}/auth/email/status`, { headers });
      return resp.ok ? resp.json() : { email: null, emailVerified: false };
    },
    enabled: !!token,
  });

  const saveKey = useMutation({
    mutationFn: async () => {
      const resp = await fetch(`${apiBase}/keys`, {
        method: "POST",
        headers,
        body: JSON.stringify({ provider: selectedProvider, key: newKey.trim() }),
      });
      if (!resp.ok) throw new Error("Failed to save key");
      return resp.json();
    },
    onSuccess: () => {
      setShowApiKey(false);
      setNewKey("");
      refetchKeys();
      Alert.alert("Saved", `${selectedProvider} API key saved securely.`);
    },
    onError: () => Alert.alert("Error", "Failed to save API key."),
  });

  const deleteKey = useMutation({
    mutationFn: async (keyId: string) => {
      await fetch(`${apiBase}/keys/${keyId}`, { method: "DELETE", headers });
    },
    onSuccess: () => refetchKeys(),
  });

  const createBusiness = useMutation({
    mutationFn: async () => {
      const resp = await fetch(`${apiBase}/businesses`, {
        method: "POST",
        headers,
        body: JSON.stringify({ name: businessName, sector: businessSector, isActive: true }),
      });
      return resp.json();
    },
    onSuccess: () => {
      setShowBusinessModal(false);
      setBusinessName("");
      setBusinessSector("");
      queryClient.invalidateQueries({ queryKey: ["businesses"] });
    },
  });

  const handleEmailRequestOtp = async () => {
    if (!emailInput.trim()) return;
    setEmailLoading(true);
    try {
      const resp = await fetch(`${apiBase}/auth/email/request-otp`, {
        method: "POST",
        headers,
        body: JSON.stringify({ email: emailInput.trim() }),
      });
      const data = await resp.json();
      if (resp.ok) {
        setEmailStep("otp");
      } else {
        Alert.alert("Error", data.error || "Failed to send verification code.");
      }
    } catch {
      Alert.alert("Error", "Network error. Please try again.");
    } finally {
      setEmailLoading(false);
    }
  };

  const handleEmailVerifyOtp = async () => {
    const code = emailOtpDigits.join("");
    if (code.length !== 6) return;
    setEmailLoading(true);
    try {
      const resp = await fetch(`${apiBase}/auth/email/verify-otp`, {
        method: "POST",
        headers,
        body: JSON.stringify({ email: emailInput.trim(), code }),
      });
      const data = await resp.json();
      if (resp.ok && data.success) {
        setShowEmailModal(false);
        setEmailInput("");
        setEmailOtpDigits(["", "", "", "", "", ""]);
        setEmailStep("input");
        refetchEmail();
        Alert.alert("Success", "Email verified successfully.");
      } else {
        Alert.alert("Error", data.error || "Invalid verification code.");
      }
    } catch {
      Alert.alert("Error", "Network error. Please try again.");
    } finally {
      setEmailLoading(false);
    }
  };

  const handleEmailResendOtp = async () => {
    setEmailLoading(true);
    try {
      await fetch(`${apiBase}/auth/email/request-otp`, {
        method: "POST",
        headers,
        body: JSON.stringify({ email: emailInput.trim() }),
      });
      Alert.alert("Sent", "A new verification code has been sent.");
      setEmailOtpDigits(["", "", "", "", "", ""]);
    } catch {
      Alert.alert("Error", "Failed to resend code.");
    } finally {
      setEmailLoading(false);
    }
  };

  const handleOtpChange = (index: number, value: string) => {
    if (value.length > 1) {
      const digits = value.replace(/[^0-9]/g, "").slice(0, 6).split("");
      const newOtp = [...emailOtpDigits];
      digits.forEach((d, i) => {
        if (index + i < 6) newOtp[index + i] = d;
      });
      setEmailOtpDigits(newOtp);
      const nextIdx = Math.min(index + digits.length, 5);
      otpRefs.current[nextIdx]?.focus();
      return;
    }
    const newOtp = [...emailOtpDigits];
    newOtp[index] = value.replace(/[^0-9]/g, "");
    setEmailOtpDigits(newOtp);
    if (value && index < 5) {
      otpRefs.current[index + 1]?.focus();
    }
  };

  const handleOtpKeyPress = (index: number, key: string) => {
    if (key === "Backspace" && !emailOtpDigits[index] && index > 0) {
      otpRefs.current[index - 1]?.focus();
    }
  };

  const openEmailModal = () => {
    setEmailInput(emailStatus?.email || "");
    setEmailOtpDigits(["", "", "", "", "", ""]);
    setEmailStep("input");
    setShowEmailModal(true);
  };

  const deleteAccount = () => {
    Alert.alert(
      "Delete Account",
      "Are you sure? This will permanently delete your account and all associated data. This action cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete Forever",
          style: "destructive",
          onPress: async () => {
            try {
              await fetch(`${apiBase}/account`, { method: "DELETE", headers });
              await logout();
            } catch {
              Alert.alert("Error", "Failed to delete account. Please try again.");
            }
          },
        },
      ],
    );
  };

  const providers = [
    { id: "openai" as const, name: "OpenAI", icon: "cpu" as const },
    { id: "anthropic" as const, name: "Anthropic", icon: "cpu" as const },
  ];

  const sectors = [
    "retail", "hospitality", "professional_services", "construction",
    "healthcare", "education", "technology", "finance", "other",
  ];

  const balancePence = walletData?.balancePence ?? 0;
  const balanceFormatted = walletData?.balanceFormatted ?? "£0.00";
  const isLowBalance = walletData?.lowBalance ?? (balancePence < 200);

  const domain = process.env["EXPO_PUBLIC_DOMAIN"];
  const portalBaseUrl = domain ? `https://${domain}/portal` : process.env["EXPO_PUBLIC_PORTAL_URL"] ?? "";

  function openPortalTopUp() {
    if (!userId || !portalBaseUrl) return;
    const url = `${portalBaseUrl}/topup?userId=${encodeURIComponent(userId)}`;
    Linking.openURL(url).catch(() => {
      Alert.alert("Error", "Could not open the top-up page. Please try again.");
    });
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Settings</Text>
        {walletData && (
          <TouchableOpacity
            style={[styles.balanceBadge, isLowBalance && styles.balanceBadgeLow]}
            onPress={openPortalTopUp}
          >
            {isLowBalance && (
              <Feather name="alert-triangle" size={12} color="#F59E0B" style={{ marginRight: 4 }} />
            )}
            <Text style={[styles.balanceText, isLowBalance && styles.balanceTextLow]}>
              {balanceFormatted}
            </Text>
          </TouchableOpacity>
        )}
      </View>

      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Account / Email section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Account</Text>
          <View style={styles.card}>
            <View style={styles.emailRow}>
              <View style={styles.emailIcon}>
                <Feather name="mail" size={16} color={GOLD} />
              </View>
              <View style={styles.emailInfo}>
                <Text style={styles.emailLabel}>Recovery Email</Text>
                <Text style={styles.emailValue}>
                  {emailStatus?.email
                    ? emailStatus.email
                    : "No email added"}
                </Text>
              </View>
              {emailStatus?.emailVerified && (
                <View style={styles.verifiedBadge}>
                  <Feather name="check-circle" size={12} color="#22C55E" />
                  <Text style={styles.verifiedText}>Verified</Text>
                </View>
              )}
            </View>
            <TouchableOpacity style={styles.addEmailBtn} onPress={openEmailModal}>
              <Feather name={emailStatus?.email ? "edit-2" : "plus"} size={14} color={GOLD} />
              <Text style={styles.addEmailText}>
                {emailStatus?.email ? "Change Email" : "Add Email"}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Wallet section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Wallet</Text>
          <View style={styles.card}>
            <View style={styles.walletRow}>
              <View style={styles.walletIconWrap}>
                <Feather name="credit-card" size={18} color={GOLD} />
              </View>
              <View style={styles.walletInfo}>
                <Text style={styles.walletLabel}>Balance</Text>
                <Text style={[styles.walletBalance, isLowBalance && styles.walletBalanceLow]}>
                  {balanceFormatted}
                </Text>
              </View>
              {isLowBalance && (
                <View style={styles.lowBalanceBadge}>
                  <Feather name="alert-triangle" size={12} color="#F59E0B" />
                  <Text style={styles.lowBalanceText}>Low</Text>
                </View>
              )}
            </View>

            {isLowBalance && (
              <View style={styles.lowBalanceBanner}>
                <Feather name="zap" size={14} color="#F59E0B" />
                <Text style={styles.lowBalanceBannerText}>
                  Your balance is low. Top up to keep using GoRigo AI.
                </Text>
              </View>
            )}

            <TouchableOpacity
              style={styles.topUpBtn}
              onPress={openPortalTopUp}
            >
              <Feather name="plus-circle" size={16} color="#0A0A0A" />
              <Text style={styles.topUpBtnText}>Top Up Credits</Text>
            </TouchableOpacity>
          </View>

          {walletData?.recentTransactions && walletData.recentTransactions.length > 0 && (
            <View style={[styles.card, { marginTop: 8 }]}>
              <Text style={styles.txTitle}>Recent Transactions</Text>
              {walletData.recentTransactions.slice(0, 5).map((tx: any) => (
                <View key={tx.id} style={styles.txRow}>
                  <View style={styles.txIconWrap}>
                    <Feather
                      name={tx.type === "credit" ? "arrow-down-circle" : "arrow-up-circle"}
                      size={14}
                      color={tx.type === "credit" ? "#22C55E" : "#EF4444"}
                    />
                  </View>
                  <View style={styles.txInfo}>
                    <Text style={styles.txDesc}>{tx.description}</Text>
                    <Text style={styles.txDate}>
                      {new Date(tx.createdAt).toLocaleDateString("en-GB", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </Text>
                  </View>
                  <Text style={[
                    styles.txAmount,
                    { color: tx.type === "credit" ? "#22C55E" : "#EF4444" },
                  ]}>
                    {tx.type === "credit" ? "+" : "-"}£{(tx.amountPence / 100).toFixed(2)}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </View>

        {/* API Keys */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>API Keys</Text>
          <View style={styles.card}>
            {keys.length === 0 ? (
              <Text style={styles.emptyText}>No API keys saved yet</Text>
            ) : (
              keys.map((key) => (
                <View key={key.id} style={styles.keyRow}>
                  <View style={styles.keyIcon}>
                    <Feather name="key" size={16} color={GOLD} />
                  </View>
                  <View style={styles.keyInfo}>
                    <Text style={styles.keyProvider}>{key.provider}</Text>
                    <Text style={styles.keyMasked}>{key.maskedKey}</Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => {
                      Alert.alert("Delete Key", `Remove ${key.provider} API key?`, [
                        { text: "Cancel" },
                        { text: "Delete", style: "destructive", onPress: () => deleteKey.mutate(key.id) },
                      ]);
                    }}
                  >
                    <Feather name="trash-2" size={16} color="#555" />
                  </TouchableOpacity>
                </View>
              ))
            )}
            <TouchableOpacity style={styles.addKeyBtn} onPress={() => setShowApiKey(true)}>
              <Feather name="plus" size={16} color={GOLD} />
              <Text style={styles.addKeyText}>Add API Key</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Tools & Integrations */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Integrations</Text>
          <TouchableOpacity
            style={styles.card}
            onPress={() => router.push("/tools" as any)}
            activeOpacity={0.8}
          >
            <View style={styles.menuRow}>
              <View style={styles.menuIcon}>
                <Feather name="tool" size={16} color={GOLD} />
              </View>
              <View style={styles.menuInfo}>
                <Text style={styles.menuLabel}>Tools & Integrations</Text>
                <Text style={styles.menuSubtext}>
                  {connectedToolsCount > 0
                    ? `${connectedToolsCount} connected`
                    : "Connect Gmail, Slack, Stripe and more"}
                </Text>
              </View>
              {connectedToolsCount > 0 && (
                <View style={{ paddingHorizontal: 8, paddingVertical: 3, backgroundColor: "#22C55E18", borderRadius: 10, marginRight: 8 }}>
                  <Text style={{ fontSize: 11, fontFamily: "Inter_600SemiBold", color: "#22C55E" }}>
                    {connectedToolsCount}
                  </Text>
                </View>
              )}
              <Feather name="chevron-right" size={16} color="#555" />
            </View>
          </TouchableOpacity>
        </View>

        {/* Knowledge Base */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>AI Knowledge</Text>
          <TouchableOpacity
            style={styles.card}
            onPress={() => router.push("/knowledge" as any)}
            activeOpacity={0.8}
          >
            <View style={styles.menuRow}>
              <View style={styles.menuIcon}>
                <Feather name="book" size={16} color={GOLD} />
              </View>
              <View style={styles.menuInfo}>
                <Text style={styles.menuLabel}>Knowledge Base</Text>
                <Text style={styles.menuSubtext}>Upload documents to teach your AI agents</Text>
              </View>
              <Feather name="chevron-right" size={16} color="#555" />
            </View>
          </TouchableOpacity>
        </View>

        {/* Businesses */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Businesses</Text>
          {businesses.map((biz) => (
            <View key={biz.id} style={[styles.bizCard, biz.isActive && styles.activeBizCard]}>
              <View style={styles.bizInfo}>
                <Text style={styles.bizName}>{biz.name}</Text>
                {biz.sector && <Text style={styles.bizSector}>{biz.sector}</Text>}
              </View>
              {biz.isActive && (
                <View style={styles.activeBadge}>
                  <Text style={styles.activeBadgeText}>Active</Text>
                </View>
              )}
            </View>
          ))}
          <TouchableOpacity style={styles.addBizBtn} onPress={() => setShowBusinessModal(true)}>
            <Feather name="plus" size={16} color={GOLD} />
            <Text style={styles.addBizText}>Add Business</Text>
          </TouchableOpacity>
        </View>

        {/* Campaign Email */}
        {businesses.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Campaign Email</Text>
            <View style={styles.card}>
              {(() => {
                const activeBiz = businesses.find((b: any) => b.isActive) || businesses[0];
                return (
                  <>
                    <View style={styles.emailRow}>
                      <View style={styles.emailIcon}>
                        <Feather name="send" size={16} color={GOLD} />
                      </View>
                      <View style={styles.emailInfo}>
                        <Text style={styles.emailLabel}>Sender Email</Text>
                        <Text style={styles.emailValue}>
                          {activeBiz?.fromEmail ?? "Not configured"}
                        </Text>
                      </View>
                    </View>
                    <TouchableOpacity
                      style={styles.addEmailBtn}
                      onPress={() => {
                        setFromEmailInput(activeBiz?.fromEmail ?? "");
                        setSmtpStatus(null);
                        setShowFromEmailModal(true);
                      }}
                    >
                      <Feather name={activeBiz?.fromEmail ? "edit-2" : "plus"} size={14} color={GOLD} />
                      <Text style={styles.addEmailText}>
                        {activeBiz?.fromEmail ? "Change Sender Email" : "Set Sender Email"}
                      </Text>
                    </TouchableOpacity>
                  </>
                );
              })()}
            </View>
          </View>
        )}

        {/* Team */}
        {teamRole && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Team</Text>
            <View style={styles.card}>
              <View style={styles.usageRow}>
                <Text style={styles.usageLabel}>Your Role</Text>
                <Text style={styles.usageValue}>{teamRole.role ?? "—"}</Text>
              </View>
            </View>
          </View>
        )}

        {/* Admin Panel — only visible to Microsoft-authenticated admin */}
        {isAdmin && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Admin</Text>
            <View style={[styles.card, { borderColor: GOLD + "44" }]}>
              <View style={styles.usageRow}>
                <Text style={styles.usageLabel}>Signed in as</Text>
                <Text style={[styles.usageValue, { color: GOLD, fontSize: 12 }]} numberOfLines={1}>
                  {adminEmail ?? "Microsoft Admin"}
                </Text>
              </View>
              <View style={[styles.usageRow, { marginTop: 8 }]}>
                <Text style={styles.usageLabel}>Access Level</Text>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Feather name="shield" size={14} color={GOLD} />
                  <Text style={[styles.usageValue, { color: GOLD }]}>Owner Admin</Text>
                </View>
              </View>
            </View>
          </View>
        )}

        {/* GoRigo AI Team */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>About GoRigo</Text>
          <View style={styles.card}>
            <TouchableOpacity
              style={styles.menuRow}
              onPress={() => router.push("/org-chart?gorigo=1")}
            >
              <View style={styles.menuIcon}>
                <Feather name="users" size={16} color={GOLD} />
              </View>
              <View style={styles.menuInfo}>
                <Text style={styles.menuLabel}>Meet the GoRigo AI Team</Text>
                <Text style={styles.menuSubtext}>GoRigo's AI Operations — who keeps it all running</Text>
              </View>
              <Feather name="chevron-right" size={16} color="#555" />
            </TouchableOpacity>
          </View>
        </View>

        {/* Danger zone */}
        <View style={styles.section}>
          <TouchableOpacity style={styles.dangerBtn} onPress={deleteAccount}>
            <Feather name="trash-2" size={16} color="#EF4444" />
            <Text style={styles.dangerBtnText}>Delete Account</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* Add API Key Modal */}
      <Modal visible={showApiKey} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={styles.modal}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Add API Key</Text>
            <TouchableOpacity onPress={() => setShowApiKey(false)}>
              <Feather name="x" size={22} color="#FFFFFF" />
            </TouchableOpacity>
          </View>
          <ScrollView style={styles.modalContent}>
            <Text style={styles.fieldLabel}>Provider</Text>
            <View style={styles.providerRow}>
              {providers.map((p) => (
                <TouchableOpacity
                  key={p.id}
                  style={[styles.providerBtn, selectedProvider === p.id && styles.providerBtnActive]}
                  onPress={() => setSelectedProvider(p.id)}
                >
                  <Text style={[styles.providerBtnText, selectedProvider === p.id && styles.providerBtnTextActive]}>
                    {p.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.fieldLabel}>API Key</Text>
            <TextInput
              style={styles.textInput}
              value={newKey}
              onChangeText={setNewKey}
              placeholder={selectedProvider === "openai" ? "sk-..." : "sk-ant-..."}
              placeholderTextColor="#555"
              secureTextEntry
              autoCapitalize="none"
            />

            <View style={styles.securityNote}>
              <Feather name="lock" size={14} color={GOLD} />
              <Text style={styles.securityText}>Your API key is encrypted with envelope encryption before storage — only you can access it.</Text>
            </View>
          </ScrollView>
          <View style={styles.modalFooter}>
            <TouchableOpacity
              style={[styles.saveBtn, !newKey.trim() && styles.saveBtnDisabled]}
              onPress={() => saveKey.mutate()}
              disabled={!newKey.trim() || saveKey.isPending}
            >
              <Text style={styles.saveBtnText}>{saveKey.isPending ? "Saving..." : "Save Key"}</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </Modal>

      {/* Add Business Modal */}
      <Modal visible={showBusinessModal} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={styles.modal}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Add Business</Text>
            <TouchableOpacity onPress={() => setShowBusinessModal(false)}>
              <Feather name="x" size={22} color="#FFFFFF" />
            </TouchableOpacity>
          </View>
          <ScrollView style={styles.modalContent}>
            <Text style={styles.fieldLabel}>Business Name *</Text>
            <TextInput
              style={styles.textInput}
              value={businessName}
              onChangeText={setBusinessName}
              placeholder="e.g. Acme Ltd"
              placeholderTextColor="#555"
            />

            <Text style={styles.fieldLabel}>Sector</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 20 }}>
              <View style={{ flexDirection: "row", gap: 8 }}>
                {sectors.map((s) => (
                  <TouchableOpacity
                    key={s}
                    style={[styles.sectorChip, businessSector === s && styles.sectorChipActive]}
                    onPress={() => setBusinessSector(s === businessSector ? "" : s)}
                  >
                    <Text style={[styles.sectorChipText, businessSector === s && styles.sectorChipTextActive]}>
                      {s.replace("_", " ")}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>
          </ScrollView>
          <View style={styles.modalFooter}>
            <TouchableOpacity
              style={[styles.saveBtn, !businessName.trim() && styles.saveBtnDisabled]}
              onPress={() => createBusiness.mutate()}
              disabled={!businessName.trim() || createBusiness.isPending}
            >
              <Text style={styles.saveBtnText}>
                {createBusiness.isPending ? "Creating..." : "Create Business"}
              </Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </Modal>

      {/* Top Up Modal */}
      <TopUpModal
        visible={showTopUpModal}
        onClose={() => setShowTopUpModal(false)}
        onSuccess={() => {
          refetchWallet();
          queryClient.invalidateQueries({ queryKey: ["wallet"] });
        }}
      />

      {/* Email Modal */}
      <Modal visible={showEmailModal} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={styles.modal}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>
              {emailStep === "input"
                ? emailStatus?.email ? "Change Email" : "Add Email"
                : "Verify Email"}
            </Text>
            <TouchableOpacity onPress={() => {
              setShowEmailModal(false);
              setEmailStep("input");
              setEmailOtpDigits(["", "", "", "", "", ""]);
            }}>
              <Feather name="x" size={22} color="#FFFFFF" />
            </TouchableOpacity>
          </View>
          <ScrollView style={styles.modalContent} keyboardShouldPersistTaps="handled">
            {emailStep === "input" ? (
              <>
                <Text style={styles.fieldLabel}>Email Address</Text>
                <TextInput
                  style={styles.textInput}
                  value={emailInput}
                  onChangeText={setEmailInput}
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
                    Your email lets you recover your account on a new device. We'll send a verification code.
                  </Text>
                </View>
              </>
            ) : (
              <>
                <Text style={styles.otpHint}>
                  We sent a 6-digit code to {emailInput}
                </Text>
                <View style={styles.otpRow}>
                  {emailOtpDigits.map((digit, i) => (
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
                <TouchableOpacity style={styles.resendBtn} onPress={handleEmailResendOtp} disabled={emailLoading}>
                  <Text style={styles.resendText}>Didn't receive a code? Resend</Text>
                </TouchableOpacity>
              </>
            )}
          </ScrollView>
          <View style={styles.modalFooter}>
            {emailStep === "input" ? (
              <TouchableOpacity
                style={[styles.saveBtn, !emailInput.trim() && styles.saveBtnDisabled]}
                onPress={handleEmailRequestOtp}
                disabled={!emailInput.trim() || emailLoading}
              >
                {emailLoading ? (
                  <ActivityIndicator color="#0A0A0A" />
                ) : (
                  <Text style={styles.saveBtnText}>Send Verification Code</Text>
                )}
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={[styles.saveBtn, emailOtpDigits.join("").length !== 6 && styles.saveBtnDisabled]}
                onPress={handleEmailVerifyOtp}
                disabled={emailOtpDigits.join("").length !== 6 || emailLoading}
              >
                {emailLoading ? (
                  <ActivityIndicator color="#0A0A0A" />
                ) : (
                  <Text style={styles.saveBtnText}>Verify Email</Text>
                )}
              </TouchableOpacity>
            )}
          </View>
        </SafeAreaView>
      </Modal>

      {/* From Email Modal */}
      <Modal visible={showFromEmailModal} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={styles.modal}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Campaign Email</Text>
            <TouchableOpacity onPress={() => setShowFromEmailModal(false)}>
              <Feather name="x" size={22} color="#FFFFFF" />
            </TouchableOpacity>
          </View>
          <ScrollView style={styles.modalContent}>
            <Text style={styles.fieldLabel}>Sender Email Address</Text>
            <TextInput
              style={styles.textInput}
              value={fromEmailInput}
              onChangeText={setFromEmailInput}
              placeholder="campaigns@yourdomain.com"
              placeholderTextColor="#555"
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />
            <View style={styles.securityNote}>
              <Feather name="info" size={14} color={GOLD} />
              <Text style={styles.securityText}>
                This email address will be used as the "From" address when sending campaign emails. Make sure it matches your SMTP configuration.
              </Text>
            </View>

            <TouchableOpacity
              style={[styles.addEmailBtn, { marginTop: 16 }]}
              onPress={async () => {
                setVerifyingSmtp(true);
                setSmtpStatus(null);
                try {
                  const resp = await fetch(`${apiBase}/campaigns/verify-sender`, {
                    method: "POST",
                    headers,
                    body: JSON.stringify({ email: fromEmailInput.trim() }),
                  });
                  const data = await resp.json();
                  setSmtpStatus(data);
                } catch {
                  setSmtpStatus({ verified: false, message: "Connection error" });
                } finally {
                  setVerifyingSmtp(false);
                }
              }}
              disabled={verifyingSmtp || !fromEmailInput.trim()}
            >
              {verifyingSmtp ? (
                <ActivityIndicator size="small" color={GOLD} />
              ) : (
                <>
                  <Feather name="check-circle" size={14} color={GOLD} />
                  <Text style={styles.addEmailText}>Verify SMTP Connection</Text>
                </>
              )}
            </TouchableOpacity>

            {smtpStatus && (
              <View style={[styles.securityNote, { marginTop: 8, borderColor: smtpStatus.verified ? "#22C55E44" : "#EF444444", backgroundColor: smtpStatus.verified ? "#22C55E08" : "#EF444408" }]}>
                <Feather name={smtpStatus.verified ? "check-circle" : "alert-circle"} size={14} color={smtpStatus.verified ? "#22C55E" : "#EF4444"} />
                <Text style={[styles.securityText, { color: smtpStatus.verified ? "#22C55E" : "#EF4444" }]}>
                  {smtpStatus.message}
                </Text>
              </View>
            )}
          </ScrollView>
          <View style={styles.modalFooter}>
            <TouchableOpacity
              style={[styles.saveBtn, !fromEmailInput.trim() && styles.saveBtnDisabled]}
              onPress={async () => {
                const activeBiz = businesses.find((b: any) => b.isActive) || businesses[0];
                if (!activeBiz) return;
                setFromEmailSaving(true);
                try {
                  const resp = await fetch(`${apiBase}/businesses/${activeBiz.id}`, {
                    method: "PUT",
                    headers,
                    body: JSON.stringify({ fromEmail: fromEmailInput.trim() }),
                  });
                  if (resp.ok) {
                    setShowFromEmailModal(false);
                    queryClient.invalidateQueries({ queryKey: ["businesses"] });
                    Alert.alert("Saved", "Campaign sender email updated.");
                  } else {
                    Alert.alert("Error", "Failed to save sender email.");
                  }
                } catch {
                  Alert.alert("Error", "Network error. Please try again.");
                } finally {
                  setFromEmailSaving(false);
                }
              }}
              disabled={!fromEmailInput.trim() || fromEmailSaving}
            >
              {fromEmailSaving ? (
                <ActivityIndicator color="#0A0A0A" />
              ) : (
                <Text style={styles.saveBtnText}>Save Sender Email</Text>
              )}
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0A0A0A" },
  header: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 16,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  headerTitle: { fontSize: 24, fontFamily: "Inter_700Bold", color: "#FFFFFF", letterSpacing: -0.5 },
  balanceBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.goldMuted,
    borderColor: GOLD + "44",
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  balanceBadgeLow: {
    backgroundColor: "#2A1F00",
    borderColor: "#F59E0B",
  },
  balanceText: {
    fontSize: 14,
    fontFamily: "Inter_700Bold",
    color: GOLD,
  },
  balanceTextLow: { color: "#F59E0B" },
  scroll: { flex: 1 },
  section: { paddingHorizontal: 20, marginBottom: 28 },
  sectionTitle: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    color: "#8A8A8A",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 12,
  },
  card: {
    backgroundColor: "#1A1A1A",
    borderColor: "#2A2A2A",
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    gap: 12,
  },
  walletRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  walletIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.goldMuted,
    justifyContent: "center",
    alignItems: "center",
  },
  walletInfo: { flex: 1 },
  walletLabel: { fontSize: 12, fontFamily: "Inter_500Medium", color: "#8A8A8A" },
  walletBalance: {
    fontSize: 22,
    fontFamily: "Inter_700Bold",
    color: "#FFFFFF",
    marginTop: 2,
  },
  walletBalanceLow: { color: "#F59E0B" },
  lowBalanceBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#2A1F00",
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderColor: "#F59E0B",
    borderWidth: 1,
  },
  lowBalanceText: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: "#F59E0B" },
  lowBalanceBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#1F1800",
    borderColor: "#F59E0B44",
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
  },
  lowBalanceBannerText: {
    flex: 1,
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: "#F59E0B",
  },
  topUpBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: GOLD,
    borderRadius: 10,
    paddingVertical: 12,
  },
  topUpBtnText: {
    fontSize: 15,
    fontFamily: "Inter_700Bold",
    color: "#0A0A0A",
  },
  txTitle: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    color: "#8A8A8A",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  txRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 4,
    borderTopColor: "#2A2A2A",
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  txIconWrap: { width: 28, height: 28, justifyContent: "center", alignItems: "center" },
  txInfo: { flex: 1 },
  txDesc: { fontSize: 13, fontFamily: "Inter_500Medium", color: "#CCCCCC" },
  txDate: { fontSize: 11, fontFamily: "Inter_400Regular", color: "#555", marginTop: 2 },
  txAmount: { fontSize: 13, fontFamily: "Inter_700Bold" },
  emailRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  emailIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.goldMuted,
    justifyContent: "center",
    alignItems: "center",
  },
  emailInfo: { flex: 1 },
  emailLabel: { fontSize: 12, fontFamily: "Inter_500Medium", color: "#8A8A8A" },
  emailValue: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#FFFFFF", marginTop: 2 },
  verifiedBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#22C55E22",
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  verifiedText: { fontSize: 11, fontFamily: "Inter_500Medium", color: "#22C55E" },
  addEmailBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingTop: 4,
    borderTopColor: "#2A2A2A",
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: 4,
    paddingVertical: 10,
  },
  addEmailText: { fontSize: 14, fontFamily: "Inter_500Medium", color: GOLD },
  usageRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  usageLabel: { fontSize: 14, fontFamily: "Inter_400Regular", color: "#8A8A8A" },
  usageValue: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#FFFFFF" },
  keyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 4,
  },
  keyIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.goldMuted,
    justifyContent: "center",
    alignItems: "center",
  },
  keyInfo: { flex: 1 },
  keyProvider: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#FFFFFF", textTransform: "capitalize" },
  keyMasked: { fontSize: 12, fontFamily: "Inter_400Regular", color: "#8A8A8A", marginTop: 2 },
  addKeyBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingTop: 4,
    borderTopColor: "#2A2A2A",
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: 4,
    paddingVertical: 10,
  },
  addKeyText: { fontSize: 14, fontFamily: "Inter_500Medium", color: GOLD },
  emptyText: { fontSize: 14, fontFamily: "Inter_400Regular", color: "#555" },
  bizCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1A1A1A",
    borderColor: "#2A2A2A",
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
  },
  activeBizCard: { borderColor: GOLD + "66" },
  bizInfo: { flex: 1 },
  bizName: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#FFFFFF" },
  bizSector: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#8A8A8A", marginTop: 2 },
  activeBadge: {
    backgroundColor: Colors.goldMuted,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  activeBadgeText: { fontSize: 12, fontFamily: "Inter_500Medium", color: GOLD },
  addBizBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderColor: "#2A2A2A",
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    backgroundColor: "#1A1A1A",
  },
  addBizText: { fontSize: 14, fontFamily: "Inter_500Medium", color: GOLD },
  dangerBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderColor: "#EF444444",
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    backgroundColor: "#1A1A1A",
  },
  dangerBtnText: { fontSize: 15, fontFamily: "Inter_500Medium", color: "#EF4444" },
  modal: { flex: 1, backgroundColor: "#0A0A0A" },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomColor: "#2A2A2A",
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  modalTitle: { fontSize: 18, fontFamily: "Inter_700Bold", color: "#FFFFFF" },
  modalContent: { flex: 1, padding: 20 },
  fieldLabel: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    color: "#8A8A8A",
    marginBottom: 8,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  textInput: {
    backgroundColor: "#1A1A1A",
    borderColor: "#2A2A2A",
    borderWidth: 1,
    borderRadius: 10,
    padding: 14,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    color: "#FFFFFF",
    marginBottom: 20,
  },
  providerRow: { flexDirection: "row", gap: 8, marginBottom: 20 },
  providerBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: "#1A1A1A",
    borderColor: "#2A2A2A",
    borderWidth: 1,
    alignItems: "center",
  },
  providerBtnActive: { borderColor: GOLD, backgroundColor: Colors.goldMuted },
  providerBtnText: { fontSize: 14, fontFamily: "Inter_500Medium", color: "#8A8A8A" },
  providerBtnTextActive: { color: GOLD },
  securityNote: {
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: Colors.goldMuted,
    borderRadius: 10,
    padding: 12,
    gap: 8,
  },
  securityText: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", color: "#8A8A8A" },
  otpHint: {
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    color: "#8A8A8A",
    textAlign: "center",
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
  sectorChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: "#1A1A1A",
    borderColor: "#2A2A2A",
    borderWidth: 1,
  },
  sectorChipActive: { borderColor: GOLD, backgroundColor: Colors.goldMuted },
  sectorChipText: { fontSize: 13, fontFamily: "Inter_500Medium", color: "#8A8A8A" },
  sectorChipTextActive: { color: GOLD },
  modalFooter: { padding: 20, borderTopColor: "#2A2A2A", borderTopWidth: StyleSheet.hairlineWidth },
  saveBtn: {
    backgroundColor: GOLD,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: "center",
  },
  saveBtnDisabled: { opacity: 0.5 },
  saveBtnText: { fontSize: 16, fontFamily: "Inter_700Bold", color: "#0A0A0A" },
  menuRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
  },
  menuIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Colors.goldMuted,
    justifyContent: "center",
    alignItems: "center",
  },
  menuInfo: { flex: 1 },
  menuLabel: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#FFFFFF" },
  menuSubtext: { fontSize: 12, fontFamily: "Inter_400Regular", color: "#8A8A8A", marginTop: 2 },
});
