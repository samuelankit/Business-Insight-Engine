import React from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter, useLocalSearchParams } from "expo-router";
import Colors from "@/constants/colors";
import { useApp } from "@/context/AppContext";

const GOLD = Colors.gold;

interface CampaignDetail {
  id: string;
  name: string;
  type: string;
  status: string;
  listId: string | null;
  subject: string | null;
  messageTemplate: string | null;
  scheduledStart: string | null;
  sentCount: number;
  deliveredCount: number;
  failedCount: number;
  repliedCount: number;
  budgetSpentPence: number;
  createdAt: string;
  updatedAt: string;
}

export default function CampaignDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { token, activeBusinessId } = useApp();
  const queryClient = useQueryClient();

  const apiBase = `https://${process.env["EXPO_PUBLIC_DOMAIN"]}/api`;
  const headers = { Authorization: `Bearer ${token ?? ""}`, "Content-Type": "application/json" };

  const { data: campaign, isLoading, refetch } = useQuery<CampaignDetail>({
    queryKey: ["campaign-detail", id],
    queryFn: async () => {
      const resp = await fetch(`${apiBase}/campaigns/${id}`, { headers });
      if (!resp.ok) throw new Error("Failed to load campaign");
      return resp.json();
    },
    enabled: !!token && !!id,
    refetchOnWindowFocus: true,
  });

  const { data: contactLists } = useQuery<{ id: string; name: string }[]>({
    queryKey: ["contact-lists", activeBusinessId],
    queryFn: async () => {
      const resp = await fetch(`${apiBase}/contacts/list?businessId=${activeBusinessId}`, { headers });
      if (!resp.ok) return [];
      return resp.json();
    },
    enabled: !!token && !!activeBusinessId && !!campaign?.listId,
  });

  const listName = campaign?.listId
    ? contactLists?.find((l) => l.id === campaign.listId)?.name ?? "Contact List"
    : null;

  const performAction = useMutation({
    mutationFn: async (action: "pause" | "resume" | "cancel") => {
      const resp = await fetch(`${apiBase}/campaigns/${id}/${action}`, {
        method: "POST",
        headers,
      });
      if (!resp.ok) {
        const err = await resp.json();
        throw new Error(err.error ?? `Failed to ${action}`);
      }
      return resp.json();
    },
    onSuccess: () => {
      refetch();
      queryClient.invalidateQueries({ queryKey: ["campaigns"] });
    },
    onError: (err: Error) => Alert.alert("Error", err.message),
  });

  const handleAction = (action: "pause" | "resume" | "cancel") => {
    const labels = {
      pause: { title: "Pause Campaign", msg: "This will pause email sending." },
      resume: { title: "Resume Campaign", msg: "This will resume email sending." },
      cancel: { title: "Cancel Campaign", msg: "This will permanently cancel the campaign." },
    };
    Alert.alert(labels[action].title, labels[action].msg, [
      { text: "Cancel", style: "cancel" },
      { text: "Confirm", onPress: () => performAction.mutate(action) },
    ]);
  };

  const statusColor = (status: string) => {
    switch (status) {
      case "running": return "#22C55E";
      case "scheduled": return "#3B82F6";
      case "paused": return "#F59E0B";
      case "failed": return "#EF4444";
      case "completed": return "#8A8A8A";
      case "cancelled": return "#EF4444";
      default: return "#555";
    }
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) +
      " " + d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  };

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator color={GOLD} size="large" />
        </View>
      </SafeAreaView>
    );
  }

  if (!campaign) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()}>
            <Feather name="arrow-left" size={22} color="#FFFFFF" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Campaign</Text>
          <View style={{ width: 22 }} />
        </View>
        <View style={styles.loadingContainer}>
          <Text style={styles.errorText}>Campaign not found</Text>
        </View>
      </SafeAreaView>
    );
  }

  const totalSent = campaign.sentCount + campaign.failedCount;
  const deliveryRate = totalSent > 0 ? Math.round((campaign.deliveredCount / totalSent) * 100) : 0;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Feather name="arrow-left" size={22} color="#FFFFFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{campaign.name}</Text>
        <TouchableOpacity onPress={() => refetch()}>
          <Feather name="refresh-cw" size={18} color="#8A8A8A" />
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.statusSection}>
          <View style={[styles.statusBadge, { backgroundColor: statusColor(campaign.status) + "22", borderColor: statusColor(campaign.status) }]}>
            <View style={[styles.statusDot, { backgroundColor: statusColor(campaign.status) }]} />
            <Text style={[styles.statusText, { color: statusColor(campaign.status) }]}>
              {campaign.status.charAt(0).toUpperCase() + campaign.status.slice(1)}
            </Text>
          </View>
          <View style={styles.typeBadge}>
            <Feather name="mail" size={12} color={GOLD} />
            <Text style={styles.typeText}>{campaign.type.toUpperCase()}</Text>
          </View>
        </View>

        <View style={styles.statsGrid}>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{campaign.sentCount}</Text>
            <Text style={styles.statLabel}>Sent</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={[styles.statValue, { color: "#22C55E" }]}>{campaign.deliveredCount}</Text>
            <Text style={styles.statLabel}>Delivered</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={[styles.statValue, { color: "#EF4444" }]}>{campaign.failedCount}</Text>
            <Text style={styles.statLabel}>Failed</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={[styles.statValue, { color: "#3B82F6" }]}>{campaign.repliedCount}</Text>
            <Text style={styles.statLabel}>Replied</Text>
          </View>
        </View>

        {totalSent > 0 && (
          <View style={styles.rateCard}>
            <Text style={styles.rateLabel}>Delivery Rate</Text>
            <View style={styles.rateBarContainer}>
              <View style={[styles.rateBar, { width: `${deliveryRate}%` }]} />
            </View>
            <Text style={styles.rateValue}>{deliveryRate}%</Text>
          </View>
        )}

        <View style={styles.detailsCard}>
          <Text style={styles.sectionTitle}>Details</Text>

          {listName && (
            <View style={styles.detailRow}>
              <Feather name="users" size={14} color="#8A8A8A" />
              <Text style={styles.detailLabel}>Audience</Text>
              <Text style={styles.detailValue}>{listName}</Text>
            </View>
          )}

          {campaign.scheduledStart && (
            <View style={styles.detailRow}>
              <Feather name="clock" size={14} color="#8A8A8A" />
              <Text style={styles.detailLabel}>Scheduled</Text>
              <Text style={styles.detailValue}>{formatDate(campaign.scheduledStart)}</Text>
            </View>
          )}

          <View style={styles.detailRow}>
            <Feather name="calendar" size={14} color="#8A8A8A" />
            <Text style={styles.detailLabel}>Created</Text>
            <Text style={styles.detailValue}>{formatDate(campaign.createdAt)}</Text>
          </View>

          {campaign.budgetSpentPence > 0 && (
            <View style={styles.detailRow}>
              <Feather name="credit-card" size={14} color="#8A8A8A" />
              <Text style={styles.detailLabel}>Cost</Text>
              <Text style={styles.detailValue}>£{(campaign.budgetSpentPence / 100).toFixed(2)}</Text>
            </View>
          )}
        </View>

        {(campaign.subject || campaign.messageTemplate) && (
          <View style={styles.previewCard}>
            <Text style={styles.sectionTitle}>Message Preview</Text>
            {campaign.subject && (
              <View style={styles.previewSubject}>
                <Text style={styles.previewSubjectLabel}>Subject</Text>
                <Text style={styles.previewSubjectText}>{campaign.subject}</Text>
              </View>
            )}
            {campaign.messageTemplate && (
              <View style={styles.previewBody}>
                <Text style={styles.previewBodyText}>
                  {campaign.messageTemplate.replace(/<[^>]*>/g, "").slice(0, 300)}
                  {campaign.messageTemplate.length > 300 ? "..." : ""}
                </Text>
              </View>
            )}
          </View>
        )}

        {(campaign.status === "running" || campaign.status === "scheduled" || campaign.status === "paused") && (
          <View style={styles.actionsSection}>
            <Text style={styles.sectionTitle}>Actions</Text>
            <View style={styles.actionsRow}>
              {campaign.status === "running" && (
                <TouchableOpacity
                  style={[styles.actionBtn, styles.pauseBtn]}
                  onPress={() => handleAction("pause")}
                  disabled={performAction.isPending}
                >
                  <Feather name="pause" size={16} color="#F59E0B" />
                  <Text style={[styles.actionBtnText, { color: "#F59E0B" }]}>Pause</Text>
                </TouchableOpacity>
              )}
              {campaign.status === "paused" && (
                <TouchableOpacity
                  style={[styles.actionBtn, styles.resumeBtn]}
                  onPress={() => handleAction("resume")}
                  disabled={performAction.isPending}
                >
                  <Feather name="play" size={16} color="#22C55E" />
                  <Text style={[styles.actionBtnText, { color: "#22C55E" }]}>Resume</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={[styles.actionBtn, styles.cancelBtn]}
                onPress={() => handleAction("cancel")}
                disabled={performAction.isPending}
              >
                <Feather name="x-circle" size={16} color="#EF4444" />
                <Text style={[styles.actionBtnText, { color: "#EF4444" }]}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0A0A0A" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontFamily: "Inter_600SemiBold",
    color: "#FFFFFF",
    textAlign: "center",
    marginHorizontal: 12,
  },
  loadingContainer: { flex: 1, justifyContent: "center", alignItems: "center" },
  errorText: { fontSize: 16, fontFamily: "Inter_400Regular", color: "#8A8A8A" },
  scroll: { flex: 1 },
  statusSection: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 20,
    marginBottom: 20,
  },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  typeBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: "#1A1A1A",
    borderWidth: 1,
    borderColor: "#2A2A2A",
  },
  typeText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: GOLD },
  statsGrid: {
    flexDirection: "row",
    paddingHorizontal: 20,
    gap: 8,
    marginBottom: 16,
  },
  statCard: {
    flex: 1,
    backgroundColor: "#1A1A1A",
    borderColor: "#2A2A2A",
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    alignItems: "center",
  },
  statValue: { fontSize: 22, fontFamily: "Inter_700Bold", color: "#FFFFFF" },
  statLabel: { fontSize: 11, fontFamily: "Inter_500Medium", color: "#8A8A8A", marginTop: 2 },
  rateCard: {
    marginHorizontal: 20,
    backgroundColor: "#1A1A1A",
    borderColor: "#2A2A2A",
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  rateLabel: { fontSize: 13, fontFamily: "Inter_500Medium", color: "#8A8A8A" },
  rateBarContainer: {
    flex: 1,
    height: 6,
    backgroundColor: "#2A2A2A",
    borderRadius: 3,
    overflow: "hidden",
  },
  rateBar: { height: "100%", backgroundColor: "#22C55E", borderRadius: 3 },
  rateValue: { fontSize: 14, fontFamily: "Inter_700Bold", color: "#22C55E" },
  detailsCard: {
    marginHorizontal: 20,
    backgroundColor: "#1A1A1A",
    borderColor: "#2A2A2A",
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
    gap: 12,
  },
  sectionTitle: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    color: "#8A8A8A",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  detailRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  detailLabel: { fontSize: 14, fontFamily: "Inter_500Medium", color: "#8A8A8A", flex: 1 },
  detailValue: { fontSize: 14, fontFamily: "Inter_400Regular", color: "#FFFFFF" },
  previewCard: {
    marginHorizontal: 20,
    backgroundColor: "#1A1A1A",
    borderColor: "#2A2A2A",
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
    gap: 10,
  },
  previewSubject: { gap: 4 },
  previewSubjectLabel: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#555", textTransform: "uppercase" },
  previewSubjectText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#FFFFFF" },
  previewBody: {
    backgroundColor: "#0A0A0A",
    borderRadius: 10,
    padding: 12,
  },
  previewBodyText: { fontSize: 14, fontFamily: "Inter_400Regular", color: "#CCCCCC", lineHeight: 20 },
  actionsSection: {
    marginHorizontal: 20,
    gap: 12,
  },
  actionsRow: { flexDirection: "row", gap: 12 },
  actionBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  pauseBtn: { borderColor: "#F59E0B", backgroundColor: "#F59E0B11" },
  resumeBtn: { borderColor: "#22C55E", backgroundColor: "#22C55E11" },
  cancelBtn: { borderColor: "#EF4444", backgroundColor: "#EF444411" },
  actionBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
});
