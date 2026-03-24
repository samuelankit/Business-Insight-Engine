import React, { useState, useRef, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
  Animated,
  DimensionValue,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import Colors from "@/constants/colors";
import { useApp } from "@/context/AppContext";
import type { GeneratedOrg, OrgNode } from "@/types/agentOrg";

const GOLD = Colors.gold;

interface ContextFields {
  businessType: string | null;
  goal: string | null;
  targetAudience: string | null;
  existingTools: string | null;
  budgetScale: string | null;
}

const FIELD_LABELS: Record<keyof ContextFields, string> = {
  businessType: "Business Type",
  goal: "Primary Goal",
  targetAudience: "Target Audience",
  existingTools: "Existing Tools",
  budgetScale: "Budget Scale",
};

const CONTEXT_QUESTIONS: Record<keyof ContextFields, string> = {
  businessType: "What type of business do you run? (e.g. retail shop, consulting firm, restaurant, estate agency)",
  goal: "What's your primary business goal right now? (e.g. grow revenue, find more customers, reduce operational costs)",
  targetAudience: "Who are your target customers? (e.g. local SMEs, UK consumers aged 25-45, property investors)",
  existingTools: "What tools or software do you already use? (e.g. Xero, Mailchimp, Shopify — or 'none')",
  budgetScale: "What's your rough monthly budget for business tools and marketing? (e.g. under £500, £500-£2000, over £2000)",
};

const FIELD_ORDER: (keyof ContextFields)[] = [
  "businessType",
  "goal",
  "targetAudience",
  "existingTools",
  "budgetScale",
];

function extractContextFromMessage(message: string): Partial<ContextFields> {
  const lower = message.toLowerCase();
  const extracted: Partial<ContextFields> = {};

  // Very basic heuristics — the real extraction is LLM-side
  if (lower.includes("restaurant") || lower.includes("café") || lower.includes("cafe") ||
      lower.includes("hotel") || lower.includes("retail") || lower.includes("shop") ||
      lower.includes("agency") || lower.includes("consulting") || lower.includes("property") ||
      lower.includes("estate") || lower.includes("tech") || lower.includes("saas") ||
      lower.includes("ecommerce") || lower.includes("business type")) {
    extracted.businessType = message.slice(0, 200);
  }

  return extracted;
}

export default function OrgBrainstormScreen() {
  const router = useRouter();
  const { token, activeBusinessId } = useApp();
  const apiBase = `https://${process.env["EXPO_PUBLIC_DOMAIN"]}/api`;
  const headers = { Authorization: `Bearer ${token ?? ""}`, "Content-Type": "application/json" };

  const [messages, setMessages] = useState<Array<{ role: "assistant" | "user"; content: string }>>([
    {
      role: "assistant",
      content: "Hi! I'm going to help you build a tailored AI specialist team for your business. To design the right team, I need to understand 5 things about your business.\n\nYou can tell me everything at once, or I'll ask about each thing one by one.\n\nLet's start — could you tell me: **what type of business do you run?**",
    },
  ]);
  const [input, setInput] = useState("");
  const [context, setContext] = useState<ContextFields>({
    businessType: null,
    goal: null,
    targetAudience: null,
    existingTools: null,
    budgetScale: null,
  });
  const [isGenerating, setIsGenerating] = useState(false);
  const [isAssembling, setIsAssembling] = useState(false);
  const [generatedOrg, setGeneratedOrg] = useState<GeneratedOrg | null>(null);
  const [vertical, setVertical] = useState("general");
  const scrollRef = useRef<ScrollView>(null);
  const fadeAnim = useRef(new Animated.Value(0)).current;

  const filledFields = Object.entries(context).filter(([, v]) => v !== null);
  const missingFields = FIELD_ORDER.filter((k) => context[k] === null);
  const allContextGathered = missingFields.length === 0;

  const getNextQuestion = useCallback(() => {
    const nextField = missingFields[0];
    if (!nextField) return null;
    return CONTEXT_QUESTIONS[nextField];
  }, [missingFields]);

  const handleSend = useCallback(async () => {
    if (!input.trim() || isGenerating) return;

    const userMsg = input.trim();
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: userMsg }]);
    setIsGenerating(true);

    try {
      // Parse context from the message using LLM
      const parseResp = await fetch(`${apiBase}/orchestrate`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          businessId: activeBusinessId ?? "unknown",
          message: `Extract context from this message for building an AI team. The user said: "${userMsg}"\n\nCurrent context: ${JSON.stringify(context)}\n\nReturn JSON with these fields (null if not mentioned, keep existing values): { "businessType": string|null, "goal": string|null, "targetAudience": string|null, "existingTools": string|null, "budgetScale": string|null, "vertical": "general"|"retail"|"ecommerce"|"professional_services"|"hospitality"|"property" }. Only return the JSON.`,
          sessionMode: null,
        }),
      });

      // Collect SSE response
      let fullResponse = "";
      if (parseResp.body) {
        const reader = parseResp.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const json = JSON.parse(line.slice(6));
                if (json.token) fullResponse += json.token;
              } catch { }
            }
          }
        }
      }

      // Try to parse JSON from response
      let newContext = { ...context };
      let detectedVertical = vertical;
      try {
        const jsonMatch = fullResponse.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          if (parsed.businessType && !context.businessType) newContext.businessType = parsed.businessType;
          if (parsed.goal && !context.goal) newContext.goal = parsed.goal;
          if (parsed.targetAudience && !context.targetAudience) newContext.targetAudience = parsed.targetAudience;
          if (parsed.existingTools && !context.existingTools) newContext.existingTools = parsed.existingTools;
          if (parsed.budgetScale && !context.budgetScale) newContext.budgetScale = parsed.budgetScale;
          if (parsed.vertical) detectedVertical = parsed.vertical;
        }
      } catch { }

      // Fallback: if the parse didn't yield a structured response, use heuristic
      if (JSON.stringify(newContext) === JSON.stringify(context)) {
        const extracted = extractContextFromMessage(userMsg);
        if (extracted.businessType && !context.businessType) {
          newContext.businessType = userMsg;
        } else {
          // Fill in next missing field with the message content
          const nextMissing = FIELD_ORDER.find((k) => newContext[k] === null);
          if (nextMissing) {
            newContext[nextMissing] = userMsg;
          }
        }
      }

      setContext(newContext);
      setVertical(detectedVertical);

      const newMissingFields = FIELD_ORDER.filter((k) => newContext[k] === null);
      const allDone = newMissingFields.length === 0;

      let assistantReply = "";
      if (allDone) {
        assistantReply = "I have everything I need! I'm now assembling your personalised AI team. This will just take a moment...";
        setMessages((prev) => [...prev, { role: "assistant", content: assistantReply }]);
        setTimeout(() => handleGenerate(newContext, detectedVertical), 500);
      } else {
        const nextField = newMissingFields[0]!;
        const collectedCount = 5 - newMissingFields.length;
        assistantReply = `Great, thank you! That's ${collectedCount} of 5 context fields.\n\nNext: ${CONTEXT_QUESTIONS[nextField]}`;
        setMessages((prev) => [...prev, { role: "assistant", content: assistantReply }]);
      }
    } catch (e) {
      // On error, just advance to the next field
      const nextMissing = FIELD_ORDER.find((k) => context[k] === null);
      if (nextMissing) {
        const newCtx = { ...context, [nextMissing]: userMsg };
        setContext(newCtx);
        const remaining = FIELD_ORDER.filter((k) => newCtx[k] === null);
        if (remaining.length > 0) {
          setMessages((prev) => [
            ...prev,
            { role: "assistant", content: CONTEXT_QUESTIONS[remaining[0]!] },
          ]);
        } else {
          setMessages((prev) => [
            ...prev,
            { role: "assistant", content: "I have everything I need! Assembling your team..." },
          ]);
          setTimeout(() => handleGenerate(newCtx, vertical), 500);
        }
      }
    } finally {
      setIsGenerating(false);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [input, context, vertical, isGenerating, activeBusinessId]);

  const handleGenerate = useCallback(async (ctx: ContextFields, vert: string) => {
    setIsAssembling(true);

    Animated.timing(fadeAnim, { toValue: 1, duration: 500, useNativeDriver: true }).start();

    try {
      const resp = await fetch(`${apiBase}/agent-orgs/generate`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          businessId: activeBusinessId,
          goalText: ctx.goal ?? "Grow the business",
          vertical: vert,
          businessType: ctx.businessType,
          targetAudience: ctx.targetAudience,
          existingTools: ctx.existingTools,
          budgetScale: ctx.budgetScale,
        }),
      });

      if (!resp.ok) {
        const err = await resp.json();
        if (err.error === "usage_limit") {
          Alert.alert("Usage Limit Reached", "You've reached your plan's AI event limit. Please upgrade to continue.");
        } else if (err.error === "tier_limit") {
          Alert.alert("Plan Limit", err.message);
        } else {
          Alert.alert("Generation Failed", "Could not generate your AI team. Please try again.");
        }
        setIsAssembling(false);
        return;
      }

      const org = await resp.json();
      setGeneratedOrg(org);
    } catch (e) {
      Alert.alert("Error", "Network error generating your team. Please try again.");
      setIsAssembling(false);
    }
  }, [activeBusinessId, headers]);

  const handleActivateTeam = useCallback(async () => {
    if (!generatedOrg) return;
    setIsAssembling(true);

    try {
      const resp = await fetch(`${apiBase}/agent-orgs`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          businessId: activeBusinessId,
          orgName: generatedOrg.orgName,
          goalText: context.goal ?? "Grow the business",
          vertical: vertical,
          nodes: generatedOrg.nodes.map((n: OrgNode) => ({
            archetypeSlug: n.archetypeSlug,
            humanName: n.humanName,
            roleSummary: n.roleSummary,
            parentIndex: n.parentIndex,
          })),
        }),
      });

      if (!resp.ok) {
        const err = await resp.json();
        Alert.alert("Error", err.message ?? "Failed to activate team.");
        setIsAssembling(false);
        return;
      }

      const chart = await resp.json();
      router.replace(`/org-chart?chartId=${chart.id}`);
    } catch (e) {
      Alert.alert("Error", "Network error. Please try again.");
      setIsAssembling(false);
    }
  }, [generatedOrg, context, vertical, activeBusinessId]);

  if (generatedOrg) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => setGeneratedOrg(null)}>
            <Feather name="arrow-left" size={22} color="#FFFFFF" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Your AI Team</Text>
          <View style={{ width: 22 }} />
        </View>

        <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.orgPreview}>
            <View style={styles.orgHeader}>
              <Text style={styles.orgName}>{generatedOrg.orgName}</Text>
              <Text style={styles.orgSubtitle}>{generatedOrg.nodes.length} AI Specialists</Text>
            </View>

            {generatedOrg.tierLimitReached && (
              <View style={styles.limitBanner}>
                <Feather name="info" size={14} color={GOLD} />
                <Text style={styles.limitText}>
                  Your plan supports up to {generatedOrg.agentLimit} AI specialists.{" "}
                  {generatedOrg.trimmedCount > 0
                    ? `${generatedOrg.trimmedCount} additional specialists available on a higher tier.`
                    : "Upgrade for more."}
                </Text>
              </View>
            )}

            {generatedOrg.nodes.map((node: OrgNode, i: number) => {
              const archetype = node.archetype;
              return (
                <View
                  key={i}
                  style={[
                    styles.nodeCard,
                    { borderLeftColor: archetype?.departmentColour ?? GOLD },
                    node.parentIndex === null && styles.nodeCardRoot,
                  ]}
                >
                  <View style={styles.nodeCardTop}>
                    <View style={[styles.nodeIcon, { backgroundColor: (archetype?.departmentColour ?? GOLD) + "22" }]}>
                      <Feather name={archetype?.iconIdentifier ?? "cpu"} size={18} color={archetype?.departmentColour ?? GOLD} />
                    </View>
                    <View style={styles.nodeInfo}>
                      <Text style={styles.nodeHumanName}>{node.humanName}</Text>
                      <Text style={styles.nodeTitle}>{archetype?.title ?? node.archetypeSlug}</Text>
                      {node.parentIndex !== null && (
                        <Text style={styles.nodeParent}>
                          Reports to: {generatedOrg.nodes[node.parentIndex]?.humanName ?? "—"}
                        </Text>
                      )}
                    </View>
                    {node.parentIndex === null && (
                      <View style={styles.rootBadge}>
                        <Text style={styles.rootBadgeText}>Lead</Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.nodeRoleSummary}>{node.roleSummary}</Text>
                </View>
              );
            })}
          </View>
        </ScrollView>

        <View style={styles.footer}>
          {isAssembling ? (
            <View style={styles.assemblingContainer}>
              <ActivityIndicator color={GOLD} />
              <Text style={styles.assemblingText}>Activating your AI team...</Text>
            </View>
          ) : (
            <TouchableOpacity style={styles.activateBtn} onPress={handleActivateTeam}>
              <Feather name="users" size={18} color="#0A0A0A" />
              <Text style={styles.activateBtnText}>Activate Team</Text>
            </TouchableOpacity>
          )}
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Feather name="x" size={22} color="#FFFFFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Build My AI Team</Text>
        <View style={{ width: 22 }} />
      </View>

      {/* Context progress */}
      <View style={styles.progressBar}>
        <View style={[styles.progressFill, { width: `${(filledFields.length / 5) * 100}%` as DimensionValue }]} />
      </View>
      <View style={styles.progressLabels}>
        <Text style={styles.progressText}>{filledFields.length} of 5 context fields gathered</Text>
        <View style={styles.fieldDots}>
          {FIELD_ORDER.map((field) => (
            <View
              key={field}
              style={[styles.fieldDot, context[field] !== null && styles.fieldDotFilled]}
            />
          ))}
        </View>
      </View>

      {/* Chat */}
      <ScrollView
        ref={scrollRef}
        style={styles.chatScroll}
        showsVerticalScrollIndicator={false}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
      >
        {messages.map((msg, i) => (
          <View
            key={i}
            style={[
              styles.bubble,
              msg.role === "user" ? styles.bubbleUser : styles.bubbleAssistant,
            ]}
          >
            {msg.role === "assistant" && (
              <View style={styles.botAvatar}>
                <Text style={styles.botAvatarText}>G</Text>
              </View>
            )}
            <View style={[styles.bubbleContent, msg.role === "user" ? styles.bubbleContentUser : styles.bubbleContentAssistant]}>
              <Text style={[styles.bubbleText, msg.role === "user" ? styles.bubbleTextUser : styles.bubbleTextAssistant]}>
                {msg.content.replace(/\*\*/g, "")}
              </Text>
            </View>
          </View>
        ))}

        {(isGenerating || isAssembling) && (
          <View style={[styles.bubble, styles.bubbleAssistant]}>
            <View style={styles.botAvatar}>
              <Text style={styles.botAvatarText}>G</Text>
            </View>
            <View style={styles.bubbleContent}>
              <ActivityIndicator size="small" color={GOLD} />
            </View>
          </View>
        )}
      </ScrollView>

      {/* Input */}
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <View style={styles.inputRow}>
          <TextInput
            style={styles.textInput}
            value={input}
            onChangeText={setInput}
            placeholder="Type your answer..."
            placeholderTextColor="#555"
            multiline
            maxLength={500}
            editable={!isGenerating && !isAssembling}
          />
          <TouchableOpacity
            style={[styles.sendBtn, (!input.trim() || isGenerating || isAssembling) && styles.sendBtnDisabled]}
            onPress={handleSend}
            disabled={!input.trim() || isGenerating || isAssembling}
          >
            <Feather name="send" size={18} color="#0A0A0A" />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
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
  headerTitle: { fontSize: 17, fontFamily: "Inter_700Bold", color: "#FFFFFF" },
  progressBar: { height: 3, backgroundColor: "#1A1A1A", marginHorizontal: 20, borderRadius: 2, marginTop: 8 },
  progressFill: { height: 3, backgroundColor: GOLD, borderRadius: 2 },
  progressLabels: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20, marginTop: 8 },
  progressText: { fontSize: 12, fontFamily: "Inter_500Medium", color: "#8A8A8A" },
  fieldDots: { flexDirection: "row", gap: 4 },
  fieldDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#2A2A2A" },
  fieldDotFilled: { backgroundColor: GOLD },
  chatScroll: { flex: 1, paddingHorizontal: 16, paddingTop: 12 },
  bubble: { flexDirection: "row", marginBottom: 14, alignItems: "flex-end", gap: 8 },
  bubbleUser: { flexDirection: "row-reverse" },
  bubbleAssistant: { flexDirection: "row" },
  botAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: GOLD,
    justifyContent: "center",
    alignItems: "center",
    flexShrink: 0,
  },
  botAvatarText: { fontSize: 13, fontFamily: "Inter_700Bold", color: "#0A0A0A" },
  bubbleContent: {
    maxWidth: "78%",
    backgroundColor: "#1A1A1A",
    borderRadius: 16,
    padding: 12,
    borderBottomLeftRadius: 4,
  },
  bubbleContentUser: {
    backgroundColor: GOLD + "22",
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 4,
  },
  bubbleContentAssistant: { borderBottomLeftRadius: 4 },
  bubbleText: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 20, color: "#FFFFFF" },
  bubbleTextUser: { color: GOLD },
  bubbleTextAssistant: { color: "#FFFFFF" },
  inputRow: {
    flexDirection: "row",
    padding: 16,
    gap: 12,
    borderTopColor: "#2A2A2A",
    borderTopWidth: StyleSheet.hairlineWidth,
    backgroundColor: "#0A0A0A",
    alignItems: "flex-end",
  },
  textInput: {
    flex: 1,
    backgroundColor: "#1A1A1A",
    borderColor: "#2A2A2A",
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    color: "#FFFFFF",
    maxHeight: 100,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: GOLD,
    justifyContent: "center",
    alignItems: "center",
  },
  sendBtnDisabled: { opacity: 0.4 },
  scroll: { flex: 1 },
  footer: { padding: 20, borderTopColor: "#2A2A2A", borderTopWidth: StyleSheet.hairlineWidth },
  orgPreview: { padding: 20, paddingBottom: 40 },
  orgHeader: { marginBottom: 16 },
  orgName: { fontSize: 22, fontFamily: "Inter_700Bold", color: "#FFFFFF", letterSpacing: -0.5 },
  orgSubtitle: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#8A8A8A", marginTop: 4 },
  limitBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: GOLD + "11",
    borderRadius: 8,
    padding: 10,
    marginBottom: 16,
    borderColor: GOLD + "33",
    borderWidth: 1,
  },
  limitText: { fontSize: 12, fontFamily: "Inter_500Medium", color: GOLD },
  nodeCard: {
    backgroundColor: "#1A1A1A",
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderLeftWidth: 3,
    borderLeftColor: GOLD,
  },
  nodeCardRoot: { borderLeftWidth: 4 },
  nodeCardLocked: { opacity: 0.5 },
  lockBadge: {
    position: "absolute",
    top: 10,
    right: 10,
  },
  nodeCardTop: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 8 },
  nodeIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: "center",
    alignItems: "center",
  },
  nodeInfo: { flex: 1 },
  nodeHumanName: { fontSize: 15, fontFamily: "Inter_700Bold", color: "#FFFFFF" },
  nodeTitle: { fontSize: 12, fontFamily: "Inter_400Regular", color: "#8A8A8A", marginTop: 2 },
  nodeParent: { fontSize: 11, fontFamily: "Inter_400Regular", color: "#555", marginTop: 2 },
  rootBadge: {
    backgroundColor: GOLD + "22",
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderColor: GOLD + "44",
    borderWidth: 1,
  },
  rootBadgeText: { fontSize: 10, fontFamily: "Inter_600SemiBold", color: GOLD },
  nodeRoleSummary: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#8A8A8A", lineHeight: 19 },
  activateBtn: {
    backgroundColor: GOLD,
    borderRadius: 14,
    paddingVertical: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  activateBtnText: { fontSize: 17, fontFamily: "Inter_700Bold", color: "#0A0A0A" },
  assemblingContainer: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 12, paddingVertical: 18 },
  assemblingText: { fontSize: 15, fontFamily: "Inter_500Medium", color: "#8A8A8A" },
});
