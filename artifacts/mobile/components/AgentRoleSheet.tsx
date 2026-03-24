import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Pressable,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import Colors from "@/constants/colors";
import type { ArchetypeKPI, KPIValue, IllustrativeStat } from "@/types/agentOrg";

const GOLD = Colors.gold;

interface SheetNode {
  humanName: string;
  archetypeSlug: string;
  department: string;
  roleSummary?: string;
  roleSummaryLong?: string;
  locked?: boolean;
  archetype?: {
    title?: string;
    department?: string;
    iconIdentifier?: string;
    departmentColour?: string;
    summary?: string;
    responsibilities?: string[];
    kpis?: ArchetypeKPI[];
  } | null;
  illustrativeStats?: IllustrativeStat[];
}

interface SheetPerformance {
  totalRuns: number;
  successRate: number;
  lastRunAt: string | null;
  lastOutput: string | null;
  statusIndicator: string;
  kpis?: KPIValue[];
}

interface AgentRoleSheetProps {
  visible: boolean;
  onClose: () => void;
  nodeId: string | null;
  node: SheetNode | null;
  isGorigoTeam: boolean;
  apiBase: string;
  headers: Record<string, string>;
}

export default function AgentRoleSheet({
  visible,
  onClose,
  nodeId,
  node,
  isGorigoTeam,
  apiBase,
  headers,
}: AgentRoleSheetProps) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<"role" | "performance">("role");

  const { data: performance, isLoading: perfLoading } = useQuery({
    queryKey: ["node-performance", nodeId],
    queryFn: async () => {
      if (!nodeId || isGorigoTeam) return null;
      const resp = await fetch(`${apiBase}/agent-orgs/nodes/${nodeId}/performance`, { headers });
      return resp.ok ? resp.json() : null;
    },
    enabled: !!nodeId && visible && !isGorigoTeam,
    staleTime: 5 * 60 * 1000,
  });

  if (!node) return null;

  const archetype = node.archetype;
  const deptColour = archetype?.departmentColour ?? GOLD;

  const renderRoleTab = () => (
    <ScrollView showsVerticalScrollIndicator={false}>
      {/* Role header */}
      <View style={[styles.roleHeader, { borderLeftColor: deptColour }]}>
        <View style={[styles.roleIcon, { backgroundColor: deptColour + "22" }]}>
          <Feather name={archetype?.iconIdentifier ?? "cpu"} size={24} color={deptColour} />
        </View>
        <View style={styles.roleHeaderInfo}>
          <Text style={styles.humanName}>{node.humanName}</Text>
          <Text style={styles.roleTitle}>{archetype?.title ?? node.archetypeSlug}</Text>
          <View style={[styles.deptBadge, { backgroundColor: deptColour + "22", borderColor: deptColour + "44" }]}>
            <Text style={[styles.deptText, { color: deptColour }]}>{node.department}</Text>
          </View>
        </View>
      </View>

      {/* Summary */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Role Summary</Text>
        <Text style={styles.summaryText}>{node.roleSummary ?? node.roleSummaryLong}</Text>
      </View>

      {/* GoRigo team illustrative stats */}
      {isGorigoTeam && node.illustrativeStats && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>GoRigo AI Operations</Text>
          <Text style={styles.illustrativeNote}>Illustrative figures representing platform activity</Text>
          {node.illustrativeStats.map((stat: IllustrativeStat, i: number) => (
            <View key={i} style={styles.statRow}>
              <Text style={styles.statLabel}>{stat.label}</Text>
              <Text style={styles.statValue}>{stat.value}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Responsibilities */}
      {archetype?.responsibilities && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Responsibilities</Text>
          {archetype.responsibilities.map((r: string, i: number) => (
            <View key={i} style={styles.responsibilityRow}>
              <View style={[styles.bullet, { backgroundColor: deptColour }]} />
              <Text style={styles.responsibilityText}>{r}</Text>
            </View>
          ))}
        </View>
      )}

      {/* KPIs */}
      {archetype?.kpis && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Key Performance Indicators</Text>
          {archetype.kpis.map((kpi: ArchetypeKPI, i: number) => {
            const perfKpi = performance?.kpis?.find((k: KPIValue) => k.key === kpi.key);
            return (
              <View key={i} style={styles.kpiRow}>
                <View style={styles.kpiInfo}>
                  <Text style={styles.kpiLabel}>{kpi.label}</Text>
                  <Text style={styles.kpiUnit}>{kpi.unit}</Text>
                </View>
                {perfKpi ? (
                  <Text style={[styles.kpiValue, { color: deptColour }]}>{perfKpi.formattedValue}</Text>
                ) : (
                  <Text style={styles.kpiValueEmpty}>—</Text>
                )}
              </View>
            );
          })}
        </View>
      )}

      {/* Coming soon: Replace Agent */}
      {!isGorigoTeam && (
        <View style={styles.comingSoonRow}>
          <Feather name="refresh-cw" size={14} color="#555" />
          <Text style={styles.comingSoonText}>Replace AI Specialist — Coming Soon</Text>
        </View>
      )}
    </ScrollView>
  );

  const renderPerformanceTab = () => {
    if (isGorigoTeam) {
      return (
        <View style={styles.emptyPerf}>
          <Feather name="info" size={32} color="#2A2A2A" />
          <Text style={styles.emptyPerfTitle}>GoRigo AI Operations</Text>
          <Text style={styles.emptyPerfText}>Performance data for GoRigo's internal AI team is not shown here. Head to the Role tab for illustrative activity figures.</Text>
        </View>
      );
    }

    if (perfLoading) {
      return (
        <View style={styles.emptyPerf}>
          <ActivityIndicator color={GOLD} />
        </View>
      );
    }

    if (!performance || performance.totalRuns === 0) {
      return (
        <View style={styles.emptyPerf}>
          <Feather name="zap" size={48} color="#2A2A2A" />
          <Text style={styles.emptyPerfTitle}>No runs yet</Text>
          <Text style={styles.emptyPerfText}>Activate this AI Specialist to start tracking performance data.</Text>
          <TouchableOpacity
            style={styles.activateBtn}
            onPress={() => {
              onClose();
              // Navigate to agents to activate
            }}
          >
            <Text style={styles.activateBtnText}>Go to Agents</Text>
          </TouchableOpacity>
        </View>
      );
    }

    return (
      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Stats overview */}
        <View style={styles.statsGrid}>
          <View style={styles.statCard}>
            <Text style={styles.statCardValue}>{performance.totalRuns}</Text>
            <Text style={styles.statCardLabel}>Total Runs</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={[styles.statCardValue, { color: "#22C55E" }]}>{performance.successRate}%</Text>
            <Text style={styles.statCardLabel}>Success Rate</Text>
          </View>
        </View>

        <View style={styles.section}>
          <View style={styles.perfRow}>
            <Text style={styles.perfLabel}>Last Active</Text>
            <Text style={styles.perfValue}>
              {performance.lastRunAt
                ? new Date(performance.lastRunAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
                : "Never"}
            </Text>
          </View>
          {performance.lastOutput && (
            <View style={styles.lastOutputBox}>
              <Text style={styles.lastOutputLabel}>Last Output Preview</Text>
              <Text style={styles.lastOutputText} numberOfLines={4}>{performance.lastOutput}</Text>
            </View>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Live KPIs</Text>
          {performance.kpis?.map((kpi: KPIValue, i: number) => (
            <View key={i} style={styles.kpiRow}>
              <View style={styles.kpiInfo}>
                <Text style={styles.kpiLabel}>{kpi.label}</Text>
              </View>
              <Text style={[styles.kpiValue, { color: GOLD }]}>{kpi.formattedValue}</Text>
            </View>
          ))}
        </View>

        {/* Deep Assessment CTA */}
        <TouchableOpacity
          style={styles.deepAssessBtn}
          onPress={() => {
            onClose();
            router.push(`/deep-assessment?nodeId=${nodeId}`);
          }}
        >
          <Feather name="bar-chart-2" size={16} color="#0A0A0A" />
          <Text style={styles.deepAssessBtnText}>Deep Assessment</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={styles.container}>
        {/* Handle + Close */}
        <View style={styles.sheetHeader}>
          <View style={styles.handle} />
          <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
            <Feather name="x" size={20} color="#8A8A8A" />
          </TouchableOpacity>
        </View>

        {/* Tabs */}
        <View style={styles.tabs}>
          <TouchableOpacity
            style={[styles.tab, activeTab === "role" && styles.tabActive]}
            onPress={() => setActiveTab("role")}
          >
            <Text style={[styles.tabText, activeTab === "role" && styles.tabTextActive]}>Role</Text>
          </TouchableOpacity>
          {!isGorigoTeam && (
            <TouchableOpacity
              style={[styles.tab, activeTab === "performance" && styles.tabActive]}
              onPress={() => setActiveTab("performance")}
            >
              <Text style={[styles.tabText, activeTab === "performance" && styles.tabTextActive]}>Performance</Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.content}>
          {activeTab === "role" ? renderRoleTab() : renderPerformanceTab()}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0A0A0A" },
  sheetHeader: {
    alignItems: "center",
    paddingTop: 12,
    paddingHorizontal: 20,
    paddingBottom: 4,
    position: "relative",
  },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: "#2A2A2A" },
  closeBtn: { position: "absolute", right: 20, top: 8, padding: 8 },
  tabs: {
    flexDirection: "row",
    paddingHorizontal: 20,
    borderBottomColor: "#2A2A2A",
    borderBottomWidth: StyleSheet.hairlineWidth,
    marginTop: 8,
  },
  tab: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  tabActive: { borderBottomColor: GOLD },
  tabText: { fontSize: 14, fontFamily: "Inter_500Medium", color: "#555" },
  tabTextActive: { color: GOLD, fontFamily: "Inter_700Bold" },
  content: { flex: 1, padding: 20 },
  roleHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingLeft: 12,
    borderLeftWidth: 3,
    borderLeftColor: GOLD,
    marginBottom: 20,
  },
  roleIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: "center",
    alignItems: "center",
  },
  roleHeaderInfo: { flex: 1, gap: 4 },
  humanName: { fontSize: 20, fontFamily: "Inter_700Bold", color: "#FFFFFF" },
  roleTitle: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#8A8A8A" },
  deptBadge: {
    alignSelf: "flex-start",
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    marginTop: 4,
  },
  deptText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  section: { marginBottom: 24 },
  sectionTitle: {
    fontSize: 11,
    fontFamily: "Inter_700Bold",
    color: "#555",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 12,
  },
  summaryText: { fontSize: 14, fontFamily: "Inter_400Regular", color: "#CCCCCC", lineHeight: 22 },
  illustrativeNote: { fontSize: 11, fontFamily: "Inter_400Regular", color: "#555", marginBottom: 10 },
  statRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 10,
    borderBottomColor: "#1A1A1A",
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  statLabel: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#8A8A8A" },
  statValue: { fontSize: 13, fontFamily: "Inter_700Bold", color: GOLD },
  responsibilityRow: { flexDirection: "row", alignItems: "flex-start", gap: 10, marginBottom: 8 },
  bullet: { width: 5, height: 5, borderRadius: 3, marginTop: 7, flexShrink: 0 },
  responsibilityText: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", color: "#CCCCCC", lineHeight: 20 },
  kpiRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
    borderBottomColor: "#1A1A1A",
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  kpiInfo: { flex: 1 },
  kpiLabel: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#CCCCCC" },
  kpiUnit: { fontSize: 11, fontFamily: "Inter_400Regular", color: "#555", marginTop: 2 },
  kpiValue: { fontSize: 15, fontFamily: "Inter_700Bold", color: GOLD },
  kpiValueEmpty: { fontSize: 15, fontFamily: "Inter_400Regular", color: "#2A2A2A" },
  comingSoonRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: "#1A1A1A",
    borderRadius: 10,
    marginTop: 8,
    marginBottom: 20,
  },
  comingSoonText: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#555" },
  emptyPerf: { flex: 1, justifyContent: "center", alignItems: "center", gap: 12, paddingVertical: 60 },
  emptyPerfTitle: { fontSize: 18, fontFamily: "Inter_700Bold", color: "#FFFFFF" },
  emptyPerfText: { fontSize: 14, fontFamily: "Inter_400Regular", color: "#8A8A8A", textAlign: "center", paddingHorizontal: 20, lineHeight: 22 },
  activateBtn: {
    backgroundColor: GOLD,
    borderRadius: 10,
    paddingHorizontal: 24,
    paddingVertical: 12,
    marginTop: 8,
  },
  activateBtnText: { fontSize: 14, fontFamily: "Inter_700Bold", color: "#0A0A0A" },
  statsGrid: { flexDirection: "row", gap: 12, marginBottom: 20 },
  statCard: {
    flex: 1,
    backgroundColor: "#1A1A1A",
    borderRadius: 12,
    padding: 16,
    alignItems: "center",
    borderColor: "#2A2A2A",
    borderWidth: 1,
  },
  statCardValue: { fontSize: 28, fontFamily: "Inter_700Bold", color: "#FFFFFF" },
  statCardLabel: { fontSize: 12, fontFamily: "Inter_400Regular", color: "#8A8A8A", marginTop: 4 },
  perfRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 10,
    borderBottomColor: "#1A1A1A",
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  perfLabel: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#8A8A8A" },
  perfValue: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#FFFFFF" },
  lastOutputBox: {
    backgroundColor: "#1A1A1A",
    borderRadius: 10,
    padding: 12,
    marginTop: 12,
    borderColor: "#2A2A2A",
    borderWidth: 1,
  },
  lastOutputLabel: { fontSize: 11, fontFamily: "Inter_700Bold", color: "#555", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 },
  lastOutputText: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#8A8A8A", lineHeight: 19 },
  deepAssessBtn: {
    backgroundColor: GOLD,
    borderRadius: 12,
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 8,
    marginBottom: 24,
  },
  deepAssessBtnText: { fontSize: 15, fontFamily: "Inter_700Bold", color: "#0A0A0A" },
});
