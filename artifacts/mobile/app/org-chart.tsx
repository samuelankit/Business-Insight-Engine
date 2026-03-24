import React, { useState, useCallback, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";
import { Feather } from "@expo/vector-icons";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Asset } from "expo-asset";
import * as FileSystem from "expo-file-system";
import Colors from "@/constants/colors";
import { useApp } from "@/context/AppContext";
import AgentRoleSheet from "@/components/AgentRoleSheet";
import type { ChartNode, GorigoNode, WebViewNodeMessage } from "@/types/agentOrg";

const GOLD = Colors.gold;

const D3_ASSET = require("../assets/d3.min.txt");

interface D3RenderNode {
  id: string;
  humanName: string;
  archetypeSlug: string;
  parentNodeId: string | null;
  department: string;
  statusIndicator?: string;
  archetype?: { title?: string; iconIdentifier?: string; departmentColour?: string } | null;
  roleSummary?: string;
}

function buildD3Html(nodes: D3RenderNode[], chartName: string, d3Script: string): string {
  const safeNodes = JSON.stringify(nodes);
  const safeName = chartName.replace(/"/g, "&quot;");

  return `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=3.0">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #0A0A0A; font-family: -apple-system, sans-serif; overflow: auto; min-height: 100vh; }
  svg { display: block; }
  .node-card { cursor: pointer; }
  text { font-family: -apple-system, sans-serif; fill: #FFFFFF; }
  .dept-text { font-size: 10px; }
  .name-text { font-size: 13px; font-weight: 700; }
  .title-text { font-size: 10px; fill: #8A8A8A; }
  .link { fill: none; stroke: #2A2A2A; stroke-width: 1.5; }
</style>
</head>
<body>
<div id="chart"></div>
<script>
${d3Script}
</script>
<script>
const nodesData = ${safeNodes};
const chartName = "${safeName}";

const WIDTH = Math.max(window.innerWidth, 320);
const NODE_W = 160;
const NODE_H = 80;
const H_GAP = 20;
const V_GAP = 60;

const rootNode = nodesData.find(n => !n.parentNodeId);
if (!rootNode) {
  document.getElementById('chart').innerHTML = '<p style="color:#555;padding:20px;">No data</p>';
} else {
  const childrenMap = {};
  nodesData.forEach(n => {
    if (n.parentNodeId) {
      if (!childrenMap[n.parentNodeId]) childrenMap[n.parentNodeId] = [];
      childrenMap[n.parentNodeId].push(n);
    }
  });

  function buildTree(node) {
    return { ...node, children: (childrenMap[node.id] || []).map(buildTree) };
  }

  const tree = d3.hierarchy(buildTree(rootNode));
  const layout = d3.tree().nodeSize([NODE_W + H_GAP, NODE_H + V_GAP]);
  layout(tree);

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  tree.each(d => {
    minX = Math.min(minX, d.x); maxX = Math.max(maxX, d.x);
    minY = Math.min(minY, d.y); maxY = Math.max(maxY, d.y);
  });

  const svgW = Math.max(WIDTH, maxX - minX + NODE_W + 60);
  const svgH = maxY - minY + NODE_H + 80;
  const offsetX = -minX + (svgW - (maxX - minX + NODE_W)) / 2 + NODE_W / 2;
  const offsetY = 40;

  const svg = d3.select('#chart').append('svg')
    .attr('width', svgW)
    .attr('height', svgH);

  const g = svg.append('g').attr('transform', \`translate(\${offsetX}, \${offsetY})\`);

  g.selectAll('.link')
    .data(tree.links())
    .enter().append('path')
    .attr('class', 'link')
    .attr('d', d3.linkVertical()
      .x(d => d.x)
      .y(d => d.y + NODE_H / 2));

  const node = g.selectAll('.node-card')
    .data(tree.descendants())
    .enter().append('g')
    .attr('class', 'node-card')
    .attr('transform', d => \`translate(\${d.x - NODE_W / 2}, \${d.y})\`)
    .on('click', function(event, d) {
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'node_tap', nodeId: d.data.id }));
      }
    });

  node.append('rect')
    .attr('width', NODE_W)
    .attr('height', NODE_H)
    .attr('rx', 10)
    .attr('fill', d => d.data.locked ? '#100A0A' : '#1A1A1A')
    .attr('stroke', d => d.data.locked ? '#EF4444' : (d.data.archetype?.departmentColour || '#2A2A2A'))
    .attr('stroke-width', d => d.data.parentNodeId ? 1 : 2)
    .attr('stroke-dasharray', d => d.data.locked ? '4,3' : 'none');

  // Status dot (hidden for locked nodes, shows lock icon instead)
  node.filter(d => !d.data.locked).append('circle')
    .attr('cx', NODE_W - 10)
    .attr('cy', 10)
    .attr('r', 4)
    .attr('fill', d => {
      const s = d.data.statusIndicator;
      if (s === 'green') return '#22C55E';
      if (s === 'amber') return '#F59E0B';
      return '#EF4444';
    });

  // Lock icon for over-limit nodes
  node.filter(d => !!d.data.locked).append('text')
    .attr('x', NODE_W - 14)
    .attr('y', 14)
    .attr('font-size', '11px')
    .attr('fill', '#EF4444')
    .text('\uD83D\uDD12');

  node.append('rect')
    .attr('width', 4)
    .attr('height', NODE_H)
    .attr('rx', 2)
    .attr('fill', d => d.data.archetype?.departmentColour || '#D4AF37');

  node.append('text')
    .attr('x', 14)
    .attr('y', 26)
    .attr('class', 'name-text')
    .text(d => d.data.humanName);

  node.append('text')
    .attr('x', 14)
    .attr('y', 42)
    .attr('class', 'title-text')
    .text(d => {
      const t = d.data.archetype?.title || '';
      return t.length > 22 ? t.slice(0, 22) + '\u2026' : t;
    });

  node.append('text')
    .attr('x', 14)
    .attr('y', 62)
    .attr('class', 'dept-text')
    .attr('fill', d => d.data.archetype?.departmentColour || '#8A8A8A')
    .text(d => d.data.department || '');

  node.append('text')
    .attr('x', 14)
    .attr('y', 76)
    .attr('class', 'dept-text')
    .attr('fill', '#555')
    .text(d => {
      const kpi = d.data.topKpi;
      return kpi ? kpi.label + ': ' + kpi.formattedValue : '';
    });
}
</script>
</body>
</html>`;
}

export default function OrgChartScreen() {
  const router = useRouter();
  const { token, activeBusinessId } = useApp();
  const { chartId, gorigo } = useLocalSearchParams<{ chartId?: string; gorigo?: string }>();
  const [showGorigo, setShowGorigo] = useState(gorigo === "1");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [showRoleSheet, setShowRoleSheet] = useState(false);
  const [d3Script, setD3Script] = useState<string | null>(null);

  useEffect(() => {
    if (Platform.OS === "web") {
      setD3Script("/* D3 not needed on web */");
      return;
    }
    (async () => {
      try {
        const [asset] = await Asset.loadAsync(D3_ASSET);
        if (asset.localUri) {
          const content = await FileSystem.readAsStringAsync(asset.localUri);
          setD3Script(content);
        }
      } catch (e) {
        console.warn("[OrgChart] Failed to load local D3 asset:", e);
        setD3Script("");
      }
    })();
  }, []);

  const apiBase = `https://${process.env["EXPO_PUBLIC_DOMAIN"]}/api`;
  const headers = { Authorization: `Bearer ${token ?? ""}`, "Content-Type": "application/json" };

  const { data: chart, isLoading } = useQuery({
    queryKey: ["org-chart", chartId],
    queryFn: async () => {
      if (!chartId) return null;
      const resp = await fetch(`${apiBase}/agent-orgs/${chartId}`, { headers });
      return resp.ok ? resp.json() : null;
    },
    enabled: !!chartId && !!token,
  });

  const { data: gorigoTeam, isLoading: gorigoLoading } = useQuery({
    queryKey: ["gorigo-team"],
    queryFn: async () => {
      const resp = await fetch(`${apiBase}/agent-orgs/gorigo`, { headers });
      return resp.ok ? resp.json() : null;
    },
    enabled: !!token && showGorigo,
    staleTime: 60 * 60 * 1000,
  });

  const handleWebViewMessage = useCallback((event: { nativeEvent: { data: string } }) => {
    try {
      const msg: WebViewNodeMessage = JSON.parse(event.nativeEvent.data);
      if (msg.type === "node_tap") {
        setSelectedNodeId(msg.nodeId);
        setShowRoleSheet(true);
      }
    } catch { }
  }, []);

  const gorigoNodes: GorigoNode[] = (gorigoTeam?.nodes ?? []).map((n: GorigoNode) => ({
    id: n.id,
    humanName: n.humanName,
    archetypeSlug: n.archetypeSlug,
    parentNodeId: n.parentNodeId,
    department: n.department,
    statusIndicator: "green" as const,
    archetype: {
      title: n.roleSummary ?? n.humanName,
      department: n.department,
      iconIdentifier: "cpu",
      departmentColour: "#D4AF37",
      summary: n.roleSummary,
    },
    roleSummary: n.roleSummary,
  }));

  const selectedNode = showGorigo
    ? gorigoNodes.find((n: GorigoNode) => n.id === selectedNodeId)
    : chart?.nodes?.find((n: ChartNode) => n.id === selectedNodeId);

  const activeNodes = showGorigo ? gorigoNodes : (chart?.nodes ?? []);
  const html = d3Script !== null
    ? buildD3Html(activeNodes, showGorigo ? "GoRigo AI Operations" : (chart?.name ?? "My AI Team"), d3Script)
    : null;

  if (!chartId && !showGorigo && gorigo !== "1") {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()}>
            <Feather name="arrow-left" size={22} color="#FFFFFF" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>AI Team</Text>
          <View style={{ width: 22 }} />
        </View>
        <View style={styles.emptyState}>
          <Feather name="users" size={48} color="#2A2A2A" />
          <Text style={styles.emptyTitle}>No Team Selected</Text>
          <Text style={styles.emptySubtext}>Go back and select an org chart to view.</Text>
          <TouchableOpacity style={styles.gorigoBtn} onPress={() => setShowGorigo(true)}>
            <Text style={styles.goriguBtnText}>View GoRigo's AI Team</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Feather name="arrow-left" size={22} color="#FFFFFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {showGorigo ? "GoRigo's AI Team" : (chart?.name ?? "AI Team")}
        </Text>
        <View style={{ width: 22 }} />
      </View>

      <View style={styles.toggleRow}>
        <TouchableOpacity
          style={[styles.toggleBtn, !showGorigo && styles.toggleBtnActive]}
          onPress={() => setShowGorigo(false)}
        >
          <Text style={[styles.toggleBtnText, !showGorigo && styles.toggleBtnTextActive]}>My Team</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.toggleBtn, showGorigo && styles.toggleBtnActive]}
          onPress={() => setShowGorigo(true)}
        >
          <Text style={[styles.toggleBtnText, showGorigo && styles.toggleBtnTextActive]}>GoRigo's Team</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.legend}>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: "#22C55E" }]} />
          <Text style={styles.legendText}>Active (last 24h)</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: "#F59E0B" }]} />
          <Text style={styles.legendText}>This week</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: "#EF4444" }]} />
          <Text style={styles.legendText}>Inactive</Text>
        </View>
      </View>

      {(isLoading && !showGorigo) || (gorigoLoading && showGorigo) || d3Script === null ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator color={GOLD} />
          <Text style={styles.loadingText}>Loading org chart...</Text>
        </View>
      ) : html && Platform.OS !== "web" ? (
        <WebView
          style={styles.webview}
          source={{ html }}
          onMessage={handleWebViewMessage}
          scrollEnabled
          bounces={false}
          showsVerticalScrollIndicator={false}
          originWhitelist={["*"]}
          javaScriptEnabled
          domStorageEnabled
          allowFileAccess
        />
      ) : (
        <View style={styles.webFallback}>
          <Feather name="cpu" size={40} color="#2A2A2A" />
          <Text style={styles.webFallbackTitle}>
            {activeNodes.length} AI Specialists
          </Text>
          <Text style={styles.webFallbackText}>
            Open in the mobile app to view the interactive org chart.
          </Text>
        </View>
      )}

      <AgentRoleSheet
        visible={showRoleSheet}
        onClose={() => setShowRoleSheet(false)}
        nodeId={selectedNodeId}
        node={selectedNode}
        isGorigoTeam={showGorigo}
        apiBase={apiBase}
        headers={headers}
      />
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
    borderBottomColor: "#2A2A2A",
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: { fontSize: 17, fontFamily: "Inter_700Bold", color: "#FFFFFF", flex: 1, textAlign: "center" },
  toggleRow: {
    flexDirection: "row",
    margin: 16,
    backgroundColor: "#1A1A1A",
    borderRadius: 10,
    padding: 3,
    gap: 3,
  },
  toggleBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: "center",
  },
  toggleBtnActive: { backgroundColor: GOLD },
  toggleBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#555" },
  toggleBtnTextActive: { color: "#0A0A0A" },
  legend: {
    flexDirection: "row",
    paddingHorizontal: 20,
    gap: 16,
    marginBottom: 8,
  },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  legendDot: { width: 7, height: 7, borderRadius: 4 },
  legendText: { fontSize: 11, fontFamily: "Inter_400Regular", color: "#555" },
  webview: { flex: 1, backgroundColor: "#0A0A0A" },
  loadingContainer: { flex: 1, justifyContent: "center", alignItems: "center", gap: 12 },
  loadingText: { fontSize: 14, fontFamily: "Inter_400Regular", color: "#555" },
  emptyState: { flex: 1, justifyContent: "center", alignItems: "center", padding: 40, gap: 12 },
  emptyTitle: { fontSize: 18, fontFamily: "Inter_700Bold", color: "#FFFFFF" },
  emptySubtext: { fontSize: 14, fontFamily: "Inter_400Regular", color: "#8A8A8A", textAlign: "center" },
  gorigoBtn: {
    marginTop: 12,
    backgroundColor: GOLD,
    borderRadius: 12,
    paddingHorizontal: 24,
    paddingVertical: 14,
  },
  goriguBtnText: { fontSize: 15, fontFamily: "Inter_700Bold", color: "#0A0A0A" },
  webFallback: { flex: 1, justifyContent: "center", alignItems: "center", padding: 40, gap: 12 },
  webFallbackTitle: { fontSize: 18, fontFamily: "Inter_700Bold", color: "#FFFFFF" },
  webFallbackText: { fontSize: 14, fontFamily: "Inter_400Regular", color: "#8A8A8A", textAlign: "center" },
});
