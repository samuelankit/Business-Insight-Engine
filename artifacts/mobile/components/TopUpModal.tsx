import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Modal,
  ActivityIndicator,
  Platform,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import Colors from "@/constants/colors";
import { useApp } from "@/context/AppContext";
import { useQueryClient } from "@tanstack/react-query";

const GOLD = Colors.gold;

const PRESET_AMOUNTS = [
  { label: "£20", pence: 2000 },
  { label: "£50", pence: 5000 },
  { label: "£100", pence: 10000 },
  { label: "£200", pence: 20000 },
  { label: "£500", pence: 50000 },
];

interface TopUpModalProps {
  visible: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export function TopUpModal({ visible, onClose, onSuccess }: TopUpModalProps) {
  const { token } = useApp();
  const queryClient = useQueryClient();
  const [selectedPence, setSelectedPence] = useState<number | null>(2000);
  const [customAmount, setCustomAmount] = useState("");
  const [useCustom, setUseCustom] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apiBase = `https://${process.env["EXPO_PUBLIC_DOMAIN"]}/api`;
  const headers = { Authorization: `Bearer ${token ?? ""}`, "Content-Type": "application/json" };

  const getAmountPence = (): number | null => {
    if (useCustom) {
      const parsed = parseFloat(customAmount);
      if (isNaN(parsed)) return null;
      return Math.round(parsed * 100);
    }
    return selectedPence;
  };

  const validateAmount = (pence: number | null): string | null => {
    if (pence === null || isNaN(pence)) return "Please enter a valid amount.";
    if (pence < 2000) return "Minimum top-up is £20.";
    if (pence > 50000) return "Maximum top-up is £500.";
    return null;
  };

  const handleTopUp = useCallback(async () => {
    const pence = getAmountPence();
    const validationError = validateAmount(pence);
    if (validationError) {
      setError(validationError);
      return;
    }

    setError(null);
    setLoading(true);

    try {
      const resp = await fetch(`${apiBase}/payments/topup/intent`, {
        method: "POST",
        headers,
        body: JSON.stringify({ amountPence: pence }),
      });

      const data = await resp.json();

      if (!resp.ok) {
        setError(data.error || "Failed to create payment. Please try again.");
        return;
      }

      const { clientSecret, amountPence } = data;

      if (Platform.OS === "web") {
        await handleWebPayment(clientSecret, amountPence);
      } else {
        setError("Native payment sheet not available in this build. Please use the web app to top up.");
      }
    } catch {
      setError("Network error. Please check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, [selectedPence, customAmount, useCustom, token]);

  const handleWebPayment = async (clientSecret: string, amountPence: number) => {
    try {
      const { loadStripe } = await import("@stripe/stripe-js");
      const publishableKey = process.env["EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY"];
      if (!publishableKey) {
        setError("Stripe is not configured. Please contact support.");
        return;
      }

      const stripe = await loadStripe(publishableKey);
      if (!stripe) {
        setError("Failed to load payment provider.");
        return;
      }

      const { error: stripeError } = await stripe.confirmPayment({
        elements: undefined as any,
        clientSecret,
        confirmParams: {
          return_url: `${window.location.origin}?topup_success=1&amount=${amountPence}`,
        },
        redirect: "if_required",
      });

      if (stripeError) {
        if (stripeError.type !== "card_error" && stripeError.type !== "validation_error") {
          setError("Payment failed. Please try again.");
        } else {
          setError(stripeError.message || "Payment failed.");
        }
        return;
      }

      await queryClient.invalidateQueries({ queryKey: ["wallet"] });
      await queryClient.invalidateQueries({ queryKey: ["usage-summary"] });
      onSuccess?.();
      onClose();
      Alert.alert("Success!", `£${(amountPence / 100).toFixed(2)} has been added to your wallet.`);
    } catch {
      setError("Payment processing error. Please try again.");
    }
  };

  const amountPence = getAmountPence();
  const canProceed = amountPence !== null && amountPence >= 2000 && amountPence <= 50000;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Top Up Wallet</Text>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn} disabled={loading}>
            <Feather name="x" size={22} color="#FFFFFF" />
          </TouchableOpacity>
        </View>

        <View style={styles.content}>
          <Text style={styles.sectionTitle}>Select Amount</Text>

          <View style={styles.presetGrid}>
            {PRESET_AMOUNTS.map((preset) => (
              <TouchableOpacity
                key={preset.pence}
                style={[
                  styles.presetBtn,
                  !useCustom && selectedPence === preset.pence && styles.presetBtnActive,
                ]}
                onPress={() => {
                  setUseCustom(false);
                  setSelectedPence(preset.pence);
                  setError(null);
                }}
                disabled={loading}
              >
                <Text
                  style={[
                    styles.presetBtnText,
                    !useCustom && selectedPence === preset.pence && styles.presetBtnTextActive,
                  ]}
                >
                  {preset.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <TouchableOpacity
            style={[styles.customToggle, useCustom && styles.customToggleActive]}
            onPress={() => {
              setUseCustom(true);
              setSelectedPence(null);
              setError(null);
            }}
            disabled={loading}
          >
            <Feather name="edit-3" size={14} color={useCustom ? GOLD : "#8A8A8A"} />
            <Text style={[styles.customToggleText, useCustom && styles.customToggleTextActive]}>
              Custom amount
            </Text>
          </TouchableOpacity>

          {useCustom && (
            <View style={styles.customInputRow}>
              <Text style={styles.currencySymbol}>£</Text>
              <TextInput
                style={styles.customInput}
                value={customAmount}
                onChangeText={(v) => {
                  setCustomAmount(v.replace(/[^0-9.]/g, ""));
                  setError(null);
                }}
                placeholder="20–500"
                placeholderTextColor="#555"
                keyboardType="decimal-pad"
                autoFocus
              />
            </View>
          )}

          <View style={styles.infoBox}>
            <Feather name="info" size={14} color={GOLD} />
            <Text style={styles.infoText}>
              Min £20 · Max £500 · GBP only. Funds are added to your wallet instantly after payment.
            </Text>
          </View>

          {error && (
            <View style={styles.errorBanner}>
              <Feather name="alert-circle" size={14} color="#EF4444" />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}
        </View>

        <View style={styles.footer}>
          <TouchableOpacity
            style={[styles.payBtn, (!canProceed || loading) && styles.payBtnDisabled]}
            onPress={handleTopUp}
            disabled={!canProceed || loading}
          >
            {loading ? (
              <ActivityIndicator size="small" color="#0A0A0A" />
            ) : (
              <>
                <Feather name="credit-card" size={16} color="#0A0A0A" />
                <Text style={styles.payBtnText}>
                  {canProceed
                    ? `Pay £${((amountPence ?? 0) / 100).toFixed(2)}`
                    : "Select an amount"}
                </Text>
              </>
            )}
          </TouchableOpacity>
          <Text style={styles.footerNote}>Powered by Stripe · Secured with TLS</Text>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0A0A0A" },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomColor: "#2A2A2A",
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: { fontSize: 20, fontFamily: "Inter_700Bold", color: "#FFFFFF" },
  closeBtn: { padding: 4 },
  content: { flex: 1, padding: 20, gap: 16 },
  sectionTitle: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    color: "#8A8A8A",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 4,
  },
  presetGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  presetBtn: {
    width: "30%",
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: "#1A1A1A",
    borderColor: "#2A2A2A",
    borderWidth: 1,
    alignItems: "center",
  },
  presetBtnActive: {
    borderColor: GOLD,
    backgroundColor: Colors.goldMuted,
  },
  presetBtnText: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
    color: "#FFFFFF",
  },
  presetBtnTextActive: { color: GOLD },
  customToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: "#1A1A1A",
    borderColor: "#2A2A2A",
    borderWidth: 1,
  },
  customToggleActive: {
    borderColor: GOLD,
    backgroundColor: Colors.goldMuted,
  },
  customToggleText: { fontSize: 14, fontFamily: "Inter_500Medium", color: "#8A8A8A" },
  customToggleTextActive: { color: GOLD },
  customInputRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1A1A1A",
    borderColor: GOLD,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 4,
  },
  currencySymbol: {
    fontSize: 20,
    fontFamily: "Inter_700Bold",
    color: GOLD,
    marginRight: 4,
  },
  customInput: {
    flex: 1,
    fontSize: 20,
    fontFamily: "Inter_700Bold",
    color: "#FFFFFF",
    paddingVertical: 10,
  },
  infoBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    backgroundColor: Colors.goldMuted,
    borderRadius: 10,
    padding: 12,
  },
  infoText: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", color: "#8A8A8A" },
  errorBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#1F1111",
    borderColor: "#EF4444",
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
  },
  errorText: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", color: "#EF4444" },
  footer: {
    padding: 20,
    gap: 10,
    borderTopColor: "#2A2A2A",
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  payBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: GOLD,
    borderRadius: 12,
    paddingVertical: 16,
  },
  payBtnDisabled: { opacity: 0.5 },
  payBtnText: { fontSize: 16, fontFamily: "Inter_700Bold", color: "#0A0A0A" },
  footerNote: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    color: "#555",
    textAlign: "center",
  },
});
