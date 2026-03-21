import React, { useState, useRef, useCallback, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Modal,
  ActivityIndicator,
  Animated,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import Colors from "@/constants/colors";
import { useApp } from "@/context/AppContext";

const GOLD = Colors.gold;

interface FrameworkDef {
  id: string;
  name: string;
  description: string;
  icon: "target" | "activity" | "flag" | "compass" | "layers" | "send" | "bar-chart-2";
}

const FRAMEWORKS: FrameworkDef[] = [
  {
    id: "swot",
    name: "SWOT Analysis",
    description: "Strengths, Weaknesses, Opportunities & Threats",
    icon: "target",
  },
  {
    id: "porters_five_forces",
    name: "Porter's 5 Forces",
    description: "Analyse your competitive environment",
    icon: "activity",
  },
  {
    id: "okrs",
    name: "OKRs",
    description: "Objectives & Key Results for your goals",
    icon: "flag",
  },
  {
    id: "blue_ocean",
    name: "Blue Ocean Strategy",
    description: "Create uncontested market space",
    icon: "compass",
  },
  {
    id: "business_model_canvas",
    name: "Business Model Canvas",
    description: "Map your entire business model",
    icon: "layers",
  },
  {
    id: "gtm_plan",
    name: "Go-to-Market Plan",
    description: "Launch and acquire customers effectively",
    icon: "send",
  },
  {
    id: "competitive_landscape",
    name: "Competitive Landscape",
    description: "Know your competition and your edge",
    icon: "bar-chart-2",
  },
];

interface SavedStrategy {
  id: string;
  framework: string;
  content: string;
  createdAt: string;
}

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function StrategyDetail({
  framework,
  businessId,
  token,
  onClose,
}: {
  framework: FrameworkDef;
  businessId: string;
  token: string;
  onClose: () => void;
}) {
  const [strategies, setStrategies] = useState<SavedStrategy[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [streamedContent, setStreamedContent] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const abortRef = useRef<AbortController | null>(null);

  const apiBase = `https://${process.env["EXPO_PUBLIC_DOMAIN"]}/api`;
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  useEffect(() => {
    loadHistory();
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const loadHistory = async () => {
    setIsLoadingHistory(true);
    try {
      const resp = await fetch(
        `${apiBase}/strategies?businessId=${businessId}&framework=${framework.id}`,
        { headers },
      );
      if (resp.ok) {
        const data = (await resp.json()) as SavedStrategy[];
        setStrategies(data);
        if (data.length > 0) {
          setActiveId(data[0]!.id);
        }
      }
    } catch {
    } finally {
      setIsLoadingHistory(false);
    }
  };

  const generate = useCallback(async () => {
    if (isGenerating) return;
    setIsGenerating(true);
    setStreamedContent("");
    setActiveId(null);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const resp = await fetch(`${apiBase}/strategies/generate`, {
        method: "POST",
        headers,
        body: JSON.stringify({ businessId, framework: framework.id }),
        signal: controller.signal,
      });

      if (!resp.ok) {
        const body = await resp.json() as { error?: string };
        setStreamedContent(`Error: ${body.error ?? "Failed to generate strategy."}`);
        return;
      }

      const reader = resp.body!.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let currentEvent = "";
      let full = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith("event: ")) {
            currentEvent = trimmed.slice(7).trim();
            continue;
          }
          if (trimmed.startsWith("data: ")) {
            try {
              const payload = JSON.parse(trimmed.slice(6)) as Record<string, unknown>;
              if (currentEvent === "token" && typeof payload["token"] === "string") {
                full += payload["token"] as string;
                setStreamedContent(full);
                scrollRef.current?.scrollToEnd({ animated: false });
              } else if (currentEvent === "error") {
                setStreamedContent((payload["message"] as string) ?? "An error occurred. Please try again.");
              } else if (currentEvent === "done") {
                const newId = payload["savedId"] as string | null;
                await loadHistory();
                if (newId) setActiveId(newId);
              }
              currentEvent = "";
            } catch { }
          }
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") return;
      setStreamedContent("Failed to connect. Please try again.");
    } finally {
      setIsGenerating(false);
      abortRef.current = null;
    }
  }, [businessId, framework.id, isGenerating]);

  const activeStrategy = strategies.find((s) => s.id === activeId);
  const displayContent = isGenerating || streamedContent
    ? streamedContent
    : activeStrategy?.content ?? null;

  return (
    <SafeAreaView style={detailStyles.container}>
      <View style={detailStyles.header}>
        <TouchableOpacity onPress={onClose} style={detailStyles.closeBtn}>
          <Feather name="x" size={20} color="#8A8A8A" />
        </TouchableOpacity>
        <View style={detailStyles.headerCenter}>
          <Feather name={framework.icon} size={18} color={GOLD} />
          <Text style={detailStyles.headerTitle}>{framework.name}</Text>
        </View>
        <TouchableOpacity
          onPress={generate}
          style={[detailStyles.generateBtn, isGenerating && detailStyles.generateBtnDisabled]}
          disabled={isGenerating}
        >
          {isGenerating ? (
            <ActivityIndicator size="small" color={GOLD} />
          ) : (
            <>
              <Feather name="zap" size={14} color={GOLD} />
              <Text style={detailStyles.generateBtnText}>Generate</Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      {strategies.length > 0 && !isGenerating && !streamedContent && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={detailStyles.historyBar}
          contentContainerStyle={detailStyles.historyBarContent}
        >
          {strategies.map((s) => (
            <TouchableOpacity
              key={s.id}
              style={[detailStyles.historyChip, s.id === activeId && detailStyles.historyChipActive]}
              onPress={() => setActiveId(s.id)}
              activeOpacity={0.7}
            >
              <Text style={[detailStyles.historyChipText, s.id === activeId && detailStyles.historyChipTextActive]}>
                {formatDate(s.createdAt)}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {isLoadingHistory && !displayContent ? (
        <View style={detailStyles.emptyState}>
          <ActivityIndicator color={GOLD} />
        </View>
      ) : displayContent ? (
        <ScrollView
          ref={scrollRef}
          style={detailStyles.contentScroll}
          contentContainerStyle={detailStyles.contentPad}
        >
          <Text style={detailStyles.contentText}>{displayContent}</Text>
          {isGenerating && (
            <Text style={detailStyles.cursor}>▊</Text>
          )}
        </ScrollView>
      ) : (
        <View style={detailStyles.emptyState}>
          <View style={detailStyles.emptyIcon}>
            <Feather name={framework.icon} size={32} color={GOLD} />
          </View>
          <Text style={detailStyles.emptyTitle}>No analysis yet</Text>
          <Text style={detailStyles.emptyDesc}>
            Tap "Generate" to create a personalised {framework.name} using your business profile.
          </Text>
          <TouchableOpacity style={detailStyles.generateLargeBtn} onPress={generate} activeOpacity={0.8}>
            <Feather name="zap" size={16} color="#0A0A0A" />
            <Text style={detailStyles.generateLargeBtnText}>Generate with Rigo AI</Text>
          </TouchableOpacity>
        </View>
      )}
    </SafeAreaView>
  );
}

export default function StrategiesScreen() {
  const { token, activeBusinessId } = useApp();
  const [selectedFramework, setSelectedFramework] = useState<FrameworkDef | null>(null);

  if (!token || !activeBusinessId) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Strategies</Text>
          <Text style={styles.headerSub}>AI-powered framework analysis</Text>
        </View>
        <View style={styles.notReady}>
          <Text style={styles.notReadyText}>Complete onboarding to access Strategies.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Strategies</Text>
        <Text style={styles.headerSub}>AI-powered framework analysis</Text>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.sectionLabel}>Choose a framework</Text>
        <View style={styles.grid}>
          {FRAMEWORKS.map((fw) => (
            <TouchableOpacity
              key={fw.id}
              style={styles.card}
              onPress={() => setSelectedFramework(fw)}
              activeOpacity={0.75}
            >
              <View style={styles.cardIcon}>
                <Feather name={fw.icon} size={22} color={GOLD} />
              </View>
              <View style={styles.cardText}>
                <Text style={styles.cardName}>{fw.name}</Text>
                <Text style={styles.cardDesc}>{fw.description}</Text>
              </View>
              <Feather name="chevron-right" size={14} color="#555" />
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>

      <Modal
        visible={!!selectedFramework}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={() => setSelectedFramework(null)}
      >
        {selectedFramework && (
          <StrategyDetail
            framework={selectedFramework}
            businessId={activeBusinessId}
            token={token}
            onClose={() => setSelectedFramework(null)}
          />
        )}
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0A0A0A" },
  header: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 12,
  },
  headerTitle: {
    fontSize: 26,
    fontFamily: "Inter_700Bold",
    color: GOLD,
    letterSpacing: -0.5,
  },
  headerSub: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: "#8A8A8A",
    marginTop: 2,
  },
  sectionLabel: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    color: "#8A8A8A",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 16,
  },
  scroll: { flex: 1 },
  scrollContent: {
    padding: 20,
    paddingBottom: 100,
  },
  grid: {
    gap: 12,
  },
  card: {
    backgroundColor: "#1A1A1A",
    borderColor: "#2A2A2A",
    borderWidth: 1,
    borderRadius: 16,
    padding: 18,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  cardIcon: {
    width: 46,
    height: 46,
    borderRadius: 14,
    backgroundColor: Colors.goldMuted,
    justifyContent: "center",
    alignItems: "center",
  },
  cardText: {
    flex: 1,
  },
  cardName: {
    fontSize: 15,
    fontFamily: "Inter_700Bold",
    color: "#FFFFFF",
  },
  cardDesc: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: "#8A8A8A",
    marginTop: 2,
  },
  notReady: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 40,
  },
  notReadyText: {
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    color: "#8A8A8A",
    textAlign: "center",
  },
});

const detailStyles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0A0A0A" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomColor: "#2A2A2A",
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#1A1A1A",
    justifyContent: "center",
    alignItems: "center",
  },
  headerCenter: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginLeft: 4,
  },
  headerTitle: {
    fontSize: 16,
    fontFamily: "Inter_700Bold",
    color: "#FFFFFF",
    flex: 1,
  },
  generateBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: Colors.goldMuted,
    borderColor: GOLD,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  generateBtnDisabled: { opacity: 0.5 },
  generateBtnText: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    color: GOLD,
  },
  historyBar: {
    maxHeight: 48,
    borderBottomColor: "#2A2A2A",
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  historyBarContent: {
    paddingHorizontal: 16,
    gap: 8,
    alignItems: "center",
    paddingVertical: 8,
  },
  historyChip: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 16,
    backgroundColor: "#1A1A1A",
    borderColor: "#2A2A2A",
    borderWidth: 1,
  },
  historyChipActive: {
    borderColor: GOLD,
    backgroundColor: Colors.goldMuted,
  },
  historyChipText: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: "#8A8A8A",
  },
  historyChipTextActive: {
    color: GOLD,
    fontFamily: "Inter_600SemiBold",
  },
  contentScroll: { flex: 1 },
  contentPad: { padding: 20, paddingBottom: 60 },
  contentText: {
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    color: "#DDDDDD",
    lineHeight: 24,
  },
  cursor: {
    fontSize: 16,
    color: GOLD,
    marginTop: 2,
  },
  emptyState: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 40,
    gap: 16,
  },
  emptyIcon: {
    width: 80,
    height: 80,
    borderRadius: 24,
    backgroundColor: Colors.goldMuted,
    borderColor: GOLD,
    borderWidth: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  emptyTitle: {
    fontSize: 20,
    fontFamily: "Inter_700Bold",
    color: "#FFFFFF",
  },
  emptyDesc: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: "#8A8A8A",
    textAlign: "center",
    lineHeight: 21,
  },
  generateLargeBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: GOLD,
    borderRadius: 14,
    paddingHorizontal: 24,
    paddingVertical: 14,
    marginTop: 8,
  },
  generateLargeBtnText: {
    fontSize: 15,
    fontFamily: "Inter_700Bold",
    color: "#0A0A0A",
  },
});
