import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Colors from "@/constants/colors";
import { useApp } from "@/context/AppContext";
import type { NodePerformance, TrendDay, RecentRunLog } from "@/types/agentOrg";

const GOLD = Colors.gold;

interface SparklineBarProps {
  value: number;
  maxValue: number;
  date: string;
}

function SparklineBar({ value, maxValue, date }: SparklineBarProps) {
  const height = maxValue > 0 ? Math.max(4, (value / maxValue) * 40) : 4;
  return (
    <View style={sparkStyles.barWrapper}>
      <View style={[sparkStyles.bar, { height, backgroundColor: value > 0 ? GOLD : "#2A2A2A" }]} />
    </View>
  );
}

const sparkStyles = StyleSheet.create({
  barWrapper: { flex: 1, justifyContent: "flex-end", height: 44, paddingHorizontal: 1 },
  bar: { borderRadius: 2, minHeight: 4 },
});

export default function DeepAssessmentScreen() {
  const router = useRouter();
  const { token } = useApp();
  const { nodeId } = useLocalSearchParams<{ nodeId?: string }>();
  const queryClient = useQueryClient();

  const apiBase = `https://${process.env["EXPO_PUBLIC_DOMAIN"]}/api`;
  const headers = { Authorization: `Bearer ${token ?? ""}`, "Content-Type": "application/json" };

  const { data: perf, isLoading } = useQuery({
    queryKey: ["node-performance", nodeId],
    queryFn: async () => {
      const resp = await fetch(`${apiBase}/agent-orgs/nodes/${nodeId}/performance`, { headers });
      return resp.ok ? resp.json() : null;
    },
    enabled: !!nodeId && !!token,
  });

  const refreshAssessment = useMutation({
    mutationFn: async () => {
      const resp = await fetch(`${apiBase}/agent-orgs/nodes/${nodeId}/assessment`, {
        method: "POST",
        headers,
      });
      if (!resp.ok) {
        const err = await resp.json();
        if (err.error === "usage_limit") {
          throw new Error("usage_limit");
        }
        throw new Error("Assessment failed");
      }
      return resp.json();
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["node-performance", nodeId], (old: NodePerformance | null | undefined) => ({
        ...(old ?? {}),
        assessmentParagraph: data.assessmentParagraph,
        assessmentCachedAt: data.assessmentCachedAt,
      }));
    },
    onError: (err: Error) => {
      if (err.message === "usage_limit") {
        Alert.alert("Usage Limit", "You've reached your AI event limit. Please upgrade your plan.");
      } else {
        Alert.alert("Error", "Could not refresh assessment. Please try again.");
      }
    },
  });

  const trend30 = perf?.trendLast30Days ?? [];
  const maxRuns = Math.max(1, ...trend30.map((d: TrendDay) => d.runs));
  const totalThisMonth = trend30.reduce((s: number, d: TrendDay) => s + d.runs, 0);

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator color={GOLD} />
        </View>
      </SafeAreaView>
    );
  }

  const hasRuns = perf && perf.totalRuns > 0;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Feather name="arrow-left" size={22} color="#FFFFFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Deep Assessment</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Agent identity */}
        {perf && (
          <View style={styles.identityCard}>
            <Text style={styles.agentName}>{perf.humanName}</Text>
            <Text style={styles.agentRole}>{perf.archetypeSlug?.replace(/-/g, " ")}</Text>
            <View style={styles.statusRow}>
              <View style={[styles.statusDot, {
                backgroundColor: perf.statusIndicator === "green" ? "#22C55E" :
                  perf.statusIndicator === "amber" ? "#F59E0B" : "#EF4444"
              }]} />
              <Text style={styles.statusText}>
                {perf.statusIndicator === "green" ? "Active — ran in the last 24 hours" :
                  perf.statusIndicator === "amber" ? "Active — ran this week" :
                    perf.totalRuns === 0 ? "No runs yet — schedule this agent to see trends" :
                      "Inactive — no recent runs"}
              </Text>
            </View>
          </View>
        )}

        {/* Run trend sparkline */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Run Trend — Last 30 Days</Text>
          {!hasRuns ? (
            <View style={styles.emptySparkline}>
              <View style={styles.sparklineContainer}>
                {Array.from({ length: 30 }).map((_, i) => (
                  <View key={i} style={sparkStyles.barWrapper}>
                    <View style={[sparkStyles.bar, { height: 4, backgroundColor: "#1A1A1A" }]} />
                  </View>
                ))}
              </View>
              <Text style={styles.emptySparklineText}>No runs yet — schedule this agent to see trends</Text>
            </View>
          ) : (
            <>
              <View style={styles.sparklineContainer}>
                {trend30.map((d: TrendDay, i: number) => (
                  <SparklineBar key={i} value={d.runs} maxValue={maxRuns} date={d.date} />
                ))}
              </View>
              <View style={styles.sparklineLabelRow}>
                <Text style={styles.sparklineLabel}>30 days ago</Text>
                <Text style={styles.sparklineLabel}>Today</Text>
              </View>
              <Text style={styles.sparklineSummary}>{totalThisMonth} runs in the last 30 days</Text>
            </>
          )}
        </View>

        {/* Success / Failure Breakdown */}
        {hasRuns && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Success / Failure Breakdown</Text>
            <View style={styles.breakdownBar}>
              <View style={[styles.breakdownFill, { flex: perf.successRate, backgroundColor: "#22C55E" }]} />
              <View style={[styles.breakdownFill, { flex: 100 - perf.successRate, backgroundColor: "#EF4444" }]} />
            </View>
            <View style={styles.breakdownLabels}>
              <View style={styles.breakdownLabelItem}>
                <View style={[styles.breakdownDot, { backgroundColor: "#22C55E" }]} />
                <Text style={styles.breakdownLabel}>Success {perf.successRate}%</Text>
              </View>
              <View style={styles.breakdownLabelItem}>
                <View style={[styles.breakdownDot, { backgroundColor: "#EF4444" }]} />
                <Text style={styles.breakdownLabel}>Needs review {100 - perf.successRate}%</Text>
              </View>
            </View>
          </View>
        )}

        {/* Recent run logs */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Recent Activity</Text>
          {!hasRuns ? (
            <View style={styles.emptyLogs}>
              <Feather name="clock" size={32} color="#2A2A2A" />
              <Text style={styles.emptyLogsText}>No activity yet. Run this agent to start building a history.</Text>
            </View>
          ) : (
            <View style={styles.logList}>
              {(perf.recentLogs ?? []).length > 0 ? (
                (perf.recentLogs as RecentRunLog[]).map((log: RecentRunLog) => (
                  <View key={log.id} style={styles.logItem}>
                    <View style={[styles.logDot, { backgroundColor: "#22C55E" }]} />
                    <View style={styles.logContent}>
                      <Text style={styles.logOutput} numberOfLines={2}>{log.summary}</Text>
                      {log.actions.length > 0 && (
                        <Text style={styles.logActions} numberOfLines={1}>
                          {log.actions.join(" · ")}
                        </Text>
                      )}
                      <Text style={styles.logDate}>
                        {new Date(log.ranAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                      </Text>
                    </View>
                  </View>
                ))
              ) : (
                <View style={styles.logItem}>
                  <View style={[styles.logDot, { backgroundColor: "#22C55E" }]} />
                  <View style={styles.logContent}>
                    <Text style={styles.logOutput} numberOfLines={2}>{perf.lastOutput}</Text>
                    <Text style={styles.logDate}>
                      Last run: {perf.lastRunAt ? new Date(perf.lastRunAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—"}
                    </Text>
                  </View>
                </View>
              )}
              <Text style={styles.logCount}>{perf.totalRuns} total run{perf.totalRuns !== 1 ? "s" : ""} recorded</Text>
            </View>
          )}
        </View>

        {/* AI Assessment */}
        <View style={styles.section}>
          <View style={styles.assessmentHeader}>
            <Text style={styles.sectionTitle}>AI Assessment</Text>
            <TouchableOpacity
              style={[styles.refreshBtn, refreshAssessment.isPending && styles.refreshBtnDisabled]}
              onPress={() => refreshAssessment.mutate()}
              disabled={refreshAssessment.isPending}
            >
              {refreshAssessment.isPending ? (
                <ActivityIndicator size="small" color={GOLD} />
              ) : (
                <>
                  <Feather name="refresh-cw" size={13} color={GOLD} />
                  <Text style={styles.refreshBtnText}>Refresh</Text>
                </>
              )}
            </TouchableOpacity>
          </View>

          {perf?.assessmentCachedAt && (
            <Text style={styles.assessmentCacheTime}>
              Assessment updated {formatRelativeTime(perf.assessmentCachedAt)}
            </Text>
          )}

          <View style={styles.assessmentBox}>
            {perf?.assessmentParagraph ? (
              <Text style={styles.assessmentText}>{perf.assessmentParagraph}</Text>
            ) : (
              <View style={styles.emptyAssessment}>
                <Feather name="zap" size={24} color="#2A2A2A" />
                <Text style={styles.emptyAssessmentText}>
                  {hasRuns
                    ? "Tap Refresh to generate an AI assessment for this agent."
                    : "Assessment will be available once this agent has completed its first run."}
                </Text>
                {hasRuns && (
                  <TouchableOpacity
                    style={styles.generateBtn}
                    onPress={() => refreshAssessment.mutate()}
                    disabled={refreshAssessment.isPending}
                  >
                    <Text style={styles.generateBtnText}>
                      {refreshAssessment.isPending ? "Generating..." : "Generate Assessment"}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
          </View>
          <Text style={styles.assessmentNote}>
            Assessments are cached for 24 hours. Each refresh uses 1 AI event from your plan.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function formatRelativeTime(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor(diff / (1000 * 60));
  if (hours >= 24) return `${Math.floor(hours / 24)} day${Math.floor(hours / 24) > 1 ? "s" : ""} ago`;
  if (hours > 0) return `${hours} hour${hours > 1 ? "s" : ""} ago`;
  if (minutes > 0) return `${minutes} minute${minutes > 1 ? "s" : ""} ago`;
  return "just now";
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0A0A0A" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomColor: "#2A2A2A",
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: { fontSize: 17, fontFamily: "Inter_700Bold", color: "#FFFFFF" },
  loadingContainer: { flex: 1, justifyContent: "center", alignItems: "center" },
  scroll: { flex: 1 },
  identityCard: {
    margin: 20,
    backgroundColor: "#1A1A1A",
    borderRadius: 12,
    padding: 16,
    borderColor: "#2A2A2A",
    borderWidth: 1,
  },
  agentName: { fontSize: 20, fontFamily: "Inter_700Bold", color: "#FFFFFF" },
  agentRole: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#8A8A8A", marginTop: 4, textTransform: "capitalize" },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { fontSize: 12, fontFamily: "Inter_400Regular", color: "#8A8A8A", flex: 1 },
  section: { paddingHorizontal: 20, marginBottom: 24 },
  sectionTitle: {
    fontSize: 11,
    fontFamily: "Inter_700Bold",
    color: "#555",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 12,
  },
  sparklineContainer: {
    flexDirection: "row",
    height: 44,
    alignItems: "flex-end",
    backgroundColor: "#0A0A0A",
    borderRadius: 8,
    paddingHorizontal: 4,
  },
  sparklineLabelRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 6 },
  sparklineLabel: { fontSize: 11, fontFamily: "Inter_400Regular", color: "#555" },
  sparklineSummary: { fontSize: 12, fontFamily: "Inter_500Medium", color: "#8A8A8A", marginTop: 6 },
  emptySparkline: { gap: 10 },
  emptySparklineText: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#555", textAlign: "center" },
  breakdownBar: { flexDirection: "row", height: 12, borderRadius: 6, overflow: "hidden", marginBottom: 10 },
  breakdownFill: {},
  breakdownLabels: { flexDirection: "row", gap: 20 },
  breakdownLabelItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  breakdownDot: { width: 8, height: 8, borderRadius: 4 },
  breakdownLabel: { fontSize: 12, fontFamily: "Inter_400Regular", color: "#8A8A8A" },
  emptyLogs: { alignItems: "center", paddingVertical: 24, gap: 10 },
  emptyLogsText: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#555", textAlign: "center" },
  logList: { gap: 2 },
  logItem: {
    flexDirection: "row",
    gap: 12,
    backgroundColor: "#1A1A1A",
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
  },
  logDot: { width: 8, height: 8, borderRadius: 4, marginTop: 4, flexShrink: 0 },
  logContent: { flex: 1 },
  logOutput: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#CCCCCC", lineHeight: 19 },
  logActions: { fontSize: 11, fontFamily: "Inter_400Regular", color: "#8A8A8A", marginTop: 2 },
  logDate: { fontSize: 11, fontFamily: "Inter_400Regular", color: "#555", marginTop: 4 },
  logCount: { fontSize: 12, fontFamily: "Inter_400Regular", color: "#555", textAlign: "center", marginTop: 4 },
  assessmentHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  refreshBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: GOLD + "22",
    borderRadius: 8,
    borderColor: GOLD + "44",
    borderWidth: 1,
  },
  refreshBtnDisabled: { opacity: 0.5 },
  refreshBtnText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: GOLD },
  assessmentCacheTime: { fontSize: 11, fontFamily: "Inter_400Regular", color: "#555", marginBottom: 10 },
  assessmentBox: {
    backgroundColor: "#1A1A1A",
    borderRadius: 12,
    padding: 16,
    borderColor: "#2A2A2A",
    borderWidth: 1,
    minHeight: 80,
  },
  assessmentText: { fontSize: 14, fontFamily: "Inter_400Regular", color: "#CCCCCC", lineHeight: 22 },
  emptyAssessment: { alignItems: "center", gap: 10, paddingVertical: 16 },
  emptyAssessmentText: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#555", textAlign: "center", lineHeight: 19 },
  generateBtn: {
    backgroundColor: GOLD,
    borderRadius: 10,
    paddingHorizontal: 20,
    paddingVertical: 10,
    marginTop: 4,
  },
  generateBtnText: { fontSize: 14, fontFamily: "Inter_700Bold", color: "#0A0A0A" },
  assessmentNote: { fontSize: 11, fontFamily: "Inter_400Regular", color: "#555", marginTop: 8 },
});
