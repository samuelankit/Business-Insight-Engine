import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Modal,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import Colors from "@/constants/colors";
import { useSubscription } from "@/lib/revenuecat";
import { useApp } from "@/context/AppContext";

const GOLD = Colors.gold;

interface Plan {
  id: string;
  name: string;
  price: string;
  eventsPerMonth: string;
  features: string[];
  packageLookupKey?: string;
  isPaid: boolean;
}

const PLANS: Plan[] = [
  {
    id: "free",
    name: "Free",
    price: "£0/mo",
    eventsPerMonth: "50 AI events",
    features: ["50 AI events per month", "Business assistant", "SWOT analysis", "Brainstorm mode"],
    isPaid: false,
  },
  {
    id: "starter",
    name: "Starter",
    price: "£19/mo",
    eventsPerMonth: "500 AI events",
    features: [
      "500 AI events per month",
      "Everything in Free",
      "Deep research mode",
      "Business plan builder",
      "Priority support",
    ],
    packageLookupKey: "$rc_monthly",
    isPaid: true,
  },
  {
    id: "pro",
    name: "Pro",
    price: "£49/mo",
    eventsPerMonth: "Unlimited AI events",
    features: [
      "Unlimited AI events",
      "Everything in Starter",
      "Voice assistant",
      "Team collaboration",
      "Advanced analytics",
      "API access",
    ],
    packageLookupKey: "gorigo_pro",
    isPaid: true,
  },
];

interface PlanModalProps {
  visible: boolean;
  onClose: () => void;
  usageData?: {
    eventsUsed: number;
    eventsLimit: number;
    planName: string;
    planId: string;
    periodEnd?: string;
  } | null;
  onPurchaseSuccess?: () => void;
}

export function PlanModal({ visible, onClose, usageData, onPurchaseSuccess }: PlanModalProps) {
  const { token } = useApp();
  const { offerings, purchase, isPurchasing } = useSubscription();
  const [purchasingPlanId, setPurchasingPlanId] = useState<string | null>(null);
  const [successPlanId, setSuccessPlanId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [confirmPlanId, setConfirmPlanId] = useState<string | null>(null);

  const handleSubscribe = async (plan: Plan) => {
    if (!plan.isPaid || !plan.packageLookupKey) return;
    setConfirmPlanId(plan.id);
  };

  const confirmPurchase = async (plan: Plan) => {
    if (!plan.isPaid || !plan.packageLookupKey) return;
    setConfirmPlanId(null);
    setErrorMsg(null);

    const allPackages = offerings?.current?.availablePackages ?? [];
    const pkg = allPackages.find((p) => p.identifier === plan.packageLookupKey);

    if (!pkg) {
      setErrorMsg("Package not available. Please try again later.");
      return;
    }

    setPurchasingPlanId(plan.id);
    try {
      await purchase(pkg);

      if (token) {
        const domain = process.env["EXPO_PUBLIC_DOMAIN"];
        try {
          await fetch(`https://${domain}/api/account/activate-plan`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ planId: plan.id }),
          });
        } catch {
        }
      }

      setSuccessPlanId(plan.id);
      setTimeout(() => {
        setSuccessPlanId(null);
        onPurchaseSuccess?.();
        onClose();
      }, 2000);
    } catch (err: any) {
      if (err?.userCancelled) {
        setErrorMsg(null);
      } else {
        setErrorMsg("Purchase failed. Please try again.");
      }
    } finally {
      setPurchasingPlanId(null);
    }
  };

  const currentPlanId = usageData?.planId ?? "free";
  const usagePct =
    usageData && usageData.eventsLimit > 0
      ? Math.min(100, (usageData.eventsUsed / usageData.eventsLimit) * 100)
      : 0;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Choose a Plan</Text>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
            <Feather name="x" size={22} color="#FFFFFF" />
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
          {usageData && (
            <View style={styles.usageSection}>
              <Text style={styles.usageSectionTitle}>Current Usage</Text>
              <View style={styles.usageCard}>
                <View style={styles.usageRow}>
                  <Text style={styles.usageLabel}>Plan</Text>
                  <Text style={styles.usageValue}>{usageData.planName}</Text>
                </View>
                <View style={styles.progressBar}>
                  <View
                    style={[
                      styles.progressFill,
                      {
                        width: `${usagePct}%` as any,
                        backgroundColor:
                          usagePct >= 100
                            ? "#EF4444"
                            : usagePct >= 80
                              ? "#F59E0B"
                              : GOLD,
                      },
                    ]}
                  />
                </View>
                <Text style={styles.usageMeta}>
                  {usageData.eventsUsed} / {usageData.eventsLimit === -1 ? "∞" : usageData.eventsLimit} AI events used
                </Text>
                {usageData.periodEnd && (
                  <Text style={styles.renewalText}>
                    Resets {new Date(usageData.periodEnd).toLocaleDateString("en-GB", { day: "numeric", month: "long" })}
                  </Text>
                )}
              </View>
            </View>
          )}

          {errorMsg && (
            <View style={styles.errorBanner}>
              <Feather name="alert-circle" size={16} color="#EF4444" />
              <Text style={styles.errorText}>{errorMsg}</Text>
            </View>
          )}

          <Text style={styles.plansTitle}>Available Plans</Text>

          {PLANS.map((plan) => {
            const isCurrent =
              currentPlanId === plan.id ||
              (currentPlanId !== "free" && plan.id === "pro" && currentPlanId === "unlimited");
            const isPurchasingThis = purchasingPlanId === plan.id;
            const isSuccess = successPlanId === plan.id;
            const isConfirming = confirmPlanId === plan.id;

            const rcPackage = plan.packageLookupKey
              ? offerings?.current?.availablePackages?.find((p) => p.identifier === plan.packageLookupKey)
              : null;

            const displayPrice = rcPackage?.product?.priceString ?? plan.price;

            return (
              <View
                key={plan.id}
                style={[
                  styles.planCard,
                  isCurrent && styles.planCardCurrent,
                  plan.id === "pro" && styles.planCardPro,
                ]}
              >
                {plan.id === "pro" && (
                  <View style={styles.popularBadge}>
                    <Text style={styles.popularBadgeText}>Most Popular</Text>
                  </View>
                )}

                <View style={styles.planHeader}>
                  <View>
                    <Text style={styles.planName}>{plan.name}</Text>
                    <Text style={styles.planEvents}>{plan.eventsPerMonth}</Text>
                  </View>
                  <Text style={styles.planPrice}>{displayPrice}</Text>
                </View>

                <View style={styles.featureList}>
                  {plan.features.map((feature) => (
                    <View key={feature} style={styles.featureRow}>
                      <Feather name="check" size={14} color={GOLD} />
                      <Text style={styles.featureText}>{feature}</Text>
                    </View>
                  ))}
                </View>

                {isCurrent ? (
                  <View style={styles.currentBadge}>
                    <Feather name="check-circle" size={14} color={GOLD} />
                    <Text style={styles.currentBadgeText}>Current Plan</Text>
                  </View>
                ) : plan.isPaid ? (
                  isConfirming ? (
                    <View style={styles.confirmRow}>
                      <Text style={styles.confirmText}>Purchase {plan.name} for {displayPrice}?</Text>
                      <View style={styles.confirmBtns}>
                        <TouchableOpacity
                          style={styles.confirmCancelBtn}
                          onPress={() => setConfirmPlanId(null)}
                        >
                          <Text style={styles.confirmCancelText}>Cancel</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.confirmYesBtn}
                          onPress={() => confirmPurchase(plan)}
                        >
                          <Text style={styles.confirmYesText}>Confirm</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  ) : (
                    <TouchableOpacity
                      style={[styles.subscribeBtn, isPurchasingThis && styles.subscribeBtnDisabled]}
                      onPress={() => handleSubscribe(plan)}
                      disabled={isPurchasing}
                      activeOpacity={0.8}
                    >
                      {isPurchasingThis ? (
                        <ActivityIndicator size="small" color="#0A0A0A" />
                      ) : isSuccess ? (
                        <>
                          <Feather name="check" size={16} color="#0A0A0A" />
                          <Text style={styles.subscribeBtnText}>Subscribed!</Text>
                        </>
                      ) : (
                        <Text style={styles.subscribeBtnText}>Subscribe</Text>
                      )}
                    </TouchableOpacity>
                  )
                ) : null}
              </View>
            );
          })}

          <View style={styles.footer}>
            <Text style={styles.footerText}>
              Subscriptions auto-renew monthly. Cancel anytime in your device settings.
            </Text>
          </View>
        </ScrollView>
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
  scroll: { flex: 1 },
  usageSection: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 8 },
  usageSectionTitle: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    color: "#8A8A8A",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 10,
  },
  usageCard: {
    backgroundColor: "#1A1A1A",
    borderColor: "#2A2A2A",
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    gap: 10,
  },
  usageRow: { flexDirection: "row", justifyContent: "space-between" },
  usageLabel: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#8A8A8A" },
  usageValue: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#FFFFFF" },
  progressBar: { height: 6, backgroundColor: "#2A2A2A", borderRadius: 3, overflow: "hidden" },
  progressFill: { height: "100%", borderRadius: 3 },
  usageMeta: { fontSize: 12, fontFamily: "Inter_400Regular", color: "#555" },
  renewalText: { fontSize: 12, fontFamily: "Inter_400Regular", color: "#555" },
  errorBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#1F1111",
    borderColor: "#EF4444",
    borderWidth: 1,
    borderRadius: 10,
    marginHorizontal: 20,
    marginTop: 12,
    padding: 12,
  },
  errorText: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#EF4444", flex: 1 },
  plansTitle: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    color: "#8A8A8A",
    textTransform: "uppercase",
    letterSpacing: 1,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 10,
  },
  planCard: {
    marginHorizontal: 20,
    marginBottom: 12,
    backgroundColor: "#1A1A1A",
    borderColor: "#2A2A2A",
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    gap: 12,
  },
  planCardCurrent: { borderColor: GOLD + "66" },
  planCardPro: { borderColor: GOLD },
  popularBadge: {
    alignSelf: "flex-start",
    backgroundColor: Colors.goldMuted,
    borderColor: GOLD,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  popularBadgeText: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: GOLD },
  planHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  planName: { fontSize: 18, fontFamily: "Inter_700Bold", color: "#FFFFFF" },
  planEvents: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#8A8A8A", marginTop: 2 },
  planPrice: { fontSize: 20, fontFamily: "Inter_700Bold", color: GOLD },
  featureList: { gap: 8 },
  featureRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  featureText: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#CCCCCC", flex: 1 },
  currentBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 8,
    justifyContent: "center",
    borderTopColor: "#2A2A2A",
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  currentBadgeText: { fontSize: 14, fontFamily: "Inter_500Medium", color: GOLD },
  subscribeBtn: {
    backgroundColor: GOLD,
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "center",
    gap: 6,
  },
  subscribeBtnDisabled: { opacity: 0.6 },
  subscribeBtnText: { fontSize: 15, fontFamily: "Inter_700Bold", color: "#0A0A0A" },
  confirmRow: { gap: 10 },
  confirmText: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#CCCCCC", textAlign: "center" },
  confirmBtns: { flexDirection: "row", gap: 8 },
  confirmCancelBtn: {
    flex: 1,
    borderColor: "#2A2A2A",
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: "center",
  },
  confirmCancelText: { fontSize: 14, fontFamily: "Inter_500Medium", color: "#8A8A8A" },
  confirmYesBtn: {
    flex: 1,
    backgroundColor: GOLD,
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: "center",
  },
  confirmYesText: { fontSize: 14, fontFamily: "Inter_700Bold", color: "#0A0A0A" },
  footer: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 32 },
  footerText: { fontSize: 11, fontFamily: "Inter_400Regular", color: "#555", textAlign: "center", lineHeight: 16 },
});
