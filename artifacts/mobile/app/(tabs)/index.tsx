import React, { useCallback, useState, useRef, useEffect } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Animated,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Colors from "@/constants/colors";
import { useApp } from "@/context/AppContext";
import { TopUpModal } from "@/components/TopUpModal";

const C = Colors.dark;

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
}

function TypingIndicator() {
  const dot1 = useRef(new Animated.Value(0.3)).current;
  const dot2 = useRef(new Animated.Value(0.3)).current;
  const dot3 = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const pulse = (dot: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(dot, { toValue: 1, duration: 300, useNativeDriver: true }),
          Animated.timing(dot, { toValue: 0.3, duration: 300, useNativeDriver: true }),
          Animated.delay(600 - delay),
        ]),
      );

    const a1 = pulse(dot1, 0);
    const a2 = pulse(dot2, 200);
    const a3 = pulse(dot3, 400);
    a1.start();
    a2.start();
    a3.start();
    return () => {
      a1.stop();
      a2.stop();
      a3.stop();
    };
  }, [dot1, dot2, dot3]);

  return (
    <View style={[styles.bubble, styles.assistantBubble, styles.typingBubble]}>
      <View style={styles.assistantIcon}>
        <Feather name="cpu" size={12} color={Colors.gold} />
      </View>
      <View style={styles.typingDots}>
        <Animated.View style={[styles.dot, { opacity: dot1 }]} />
        <Animated.View style={[styles.dot, { opacity: dot2 }]} />
        <Animated.View style={[styles.dot, { opacity: dot3 }]} />
      </View>
    </View>
  );
}

export default function DashboardScreen() {
  const { userId, activeBusinessId, token } = useApp();
  const queryClient = useQueryClient();
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [showTyping, setShowTyping] = useState(false);
  const [showTopUpModal, setShowTopUpModal] = useState(false);
  const [insufficientBalance, setInsufficientBalance] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const abortRef = useRef<AbortController | null>(null);

  const { data: walletData, refetch: refetchWallet } = useQuery({
    queryKey: ["wallet", userId],
    queryFn: async () => {
      if (!token) return null;
      const domain = process.env["EXPO_PUBLIC_DOMAIN"];
      const resp = await fetch(`https://${domain}/api/usage/wallet`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return resp.ok ? resp.json() : null;
    },
    enabled: !!token,
    refetchInterval: 30000,
  });

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!token || !activeBusinessId) return;
    loadHistory();
  }, [token, activeBusinessId]);

  const loadHistory = async () => {
    if (!token || !activeBusinessId) return;
    try {
      const domain = process.env["EXPO_PUBLIC_DOMAIN"];
      const resp = await fetch(`https://${domain}/api/orchestrate/history?businessId=${activeBusinessId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) {
        setMessages([
          {
            id: "welcome",
            role: "assistant",
            content: "Welcome to GoRigo! I'm your AI business assistant. Ask me anything about your business, or choose a mode below to get started.",
          },
        ]);
        return;
      }
      const data = (await resp.json()) as { messages: Array<{ id: string; role: "user" | "assistant"; content: string }> };
      if (data.messages.length === 0) {
        setMessages([
          {
            id: "welcome",
            role: "assistant",
            content: "Welcome to GoRigo! I'm your AI business assistant. Ask me anything about your business, or choose a mode below to get started.",
          },
        ]);
      } else {
        setMessages(data.messages);
      }
    } catch {
      setMessages([
        {
          id: "welcome",
          role: "assistant",
          content: "Welcome to GoRigo! I'm your AI business assistant. Ask me anything about your business, or choose a mode below to get started.",
        },
      ]);
    }
  };

  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [messages.length]);

  const streamMessage = useCallback(async (msg: string, sessionMode?: string) => {
    if (!token || !activeBusinessId || isStreaming) return;

    const userMsgId = Date.now().toString();
    setMessages((prev) => [...prev, { id: userMsgId, role: "user", content: msg }]);
    setShowTyping(true);
    setIsStreaming(true);

    const domain = process.env["EXPO_PUBLIC_DOMAIN"];
    const controller = new AbortController();
    abortRef.current = controller;

    const streamingId = (Date.now() + 1).toString();

    try {
      const resp = await fetch(`https://${domain}/api/orchestrate`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify({
          message: msg,
          businessId: activeBusinessId,
          ...(sessionMode ? { sessionMode } : {}),
        }),
        signal: controller.signal,
      });

      if (resp.status === 402) {
        const body = await resp.json();
        if (body.error === "insufficient_balance") {
          setShowTyping(false);
          setIsStreaming(false);
          abortRef.current = null;
          setInsufficientBalance(true);
          return;
        }
        throw new Error(`HTTP ${resp.status}`);
      }

      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
      }

      setShowTyping(false);

      const reader = resp.body!.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let currentEvent = "";
      let firstToken = true;

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
                const tok = payload["token"] as string;
                if (firstToken) {
                  firstToken = false;
                  setMessages((prev) => [
                    ...prev,
                    { id: streamingId, role: "assistant", content: tok, streaming: true },
                  ]);
                } else {
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === streamingId ? { ...m, content: m.content + tok } : m,
                    ),
                  );
                }
                scrollRef.current?.scrollToEnd({ animated: false });
              } else if (currentEvent === "done") {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === streamingId ? { ...m, streaming: false } : m,
                  ),
                );
                await refetchWallet();
              }

              currentEvent = "";
            } catch {
            }
          }
        }
      }

      setMessages((prev) =>
        prev.map((m) => (m.id === streamingId ? { ...m, streaming: false } : m)),
      );
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") return;
      setShowTyping(false);
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now().toString(),
          role: "assistant",
          content: "Sorry, I had trouble connecting. Please check your API key in Settings.",
        },
      ]);
    } finally {
      setShowTyping(false);
      setIsStreaming(false);
      abortRef.current = null;
    }
  }, [token, activeBusinessId, isStreaming, refetchWallet]);

  const sendMessage = useCallback(() => {
    const trimmed = message.trim();
    if (!trimmed || isStreaming) return;
    setMessage("");
    void streamMessage(trimmed);
  }, [message, isStreaming, streamMessage]);

  const modes = [
    { id: "deep_research", label: "Deep Research", icon: "search" as const },
    { id: "strategy_swot", label: "Strategy SWOT", icon: "target" as const },
    { id: "brainstorm", label: "Brainstorm", icon: "zap" as const },
    { id: "business_plan", label: "Business Plan", icon: "file-text" as const },
  ];

  const handleMode = (modeId: string, label: string) => {
    const prompt = `Start a ${label} session for my business.`;
    void streamMessage(prompt, modeId);
  };

  const balancePence = walletData?.balancePence ?? null;
  const balanceFormatted = walletData?.balanceFormatted ?? null;
  const isLowBalance = walletData?.lowBalance ?? false;
  const badgeColor = balancePence !== null && isLowBalance ? "#F59E0B" : Colors.gold;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>GoRigo</Text>
          <Text style={styles.headerSub}>AI Business OS</Text>
        </View>
        {balanceFormatted && (
          <TouchableOpacity
            style={[styles.usageBadge, { borderColor: badgeColor + "66" }]}
            onPress={() => setShowTopUpModal(true)}
            activeOpacity={0.7}
          >
            {isLowBalance && (
              <Feather name="alert-triangle" size={11} color="#F59E0B" style={{ marginRight: 4 }} />
            )}
            <Text style={[styles.usageText, { color: badgeColor }]}>
              {balanceFormatted}
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Low balance warning banner */}
      {isLowBalance && !insufficientBalance && (
        <TouchableOpacity
          style={styles.warningBanner}
          onPress={() => setShowTopUpModal(true)}
          activeOpacity={0.8}
        >
          <Feather name="alert-triangle" size={14} color="#F59E0B" />
          <Text style={styles.warningText}>
            Your balance is low ({balanceFormatted}).{" "}
            <Text style={styles.warningLink}>Top up to continue.</Text>
          </Text>
        </TouchableOpacity>
      )}

      {/* Insufficient balance inline banner */}
      {insufficientBalance && (
        <TouchableOpacity
          style={styles.insufficientBanner}
          onPress={() => {
            setInsufficientBalance(false);
            setShowTopUpModal(true);
          }}
          activeOpacity={0.8}
        >
          <Feather name="zap-off" size={14} color="#EF4444" />
          <Text style={styles.insufficientText}>
            Insufficient balance.{" "}
            <Text style={styles.insufficientLink}>Top up to continue.</Text>
          </Text>
        </TouchableOpacity>
      )}

      {/* Quick mode buttons */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.modeScroll}
        contentContainerStyle={styles.modeScrollContent}
      >
        {modes.map((m) => (
          <TouchableOpacity
            key={m.id}
            style={styles.modeChip}
            onPress={() => handleMode(m.id, m.label)}
            activeOpacity={0.7}
            disabled={isStreaming}
          >
            <Feather name={m.icon} size={14} color={Colors.gold} />
            <Text style={styles.modeChipText}>{m.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ScrollView
        ref={scrollRef}
        style={styles.chatArea}
        contentContainerStyle={styles.chatContent}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
      >
        {messages.map((msg) => (
          <View
            key={msg.id}
            style={[
              styles.bubble,
              msg.role === "user" ? styles.userBubble : styles.assistantBubble,
            ]}
          >
            {msg.role === "assistant" && (
              <View style={styles.assistantIcon}>
                <Feather name="cpu" size={12} color={Colors.gold} />
              </View>
            )}
            <Text
              style={[
                styles.bubbleText,
                msg.role === "user"
                  ? styles.userBubbleText
                  : styles.assistantBubbleText,
              ]}
            >
              {msg.content}
            </Text>
          </View>
        ))}
        {showTyping && <TypingIndicator />}
      </ScrollView>

      <View style={styles.inputBar}>
        <TextInput
          style={styles.input}
          value={message}
          onChangeText={setMessage}
          placeholder="Ask GoRigo anything..."
          placeholderTextColor={C.textTertiary}
          multiline
          maxLength={4000}
          returnKeyType="send"
          onSubmitEditing={sendMessage}
          editable={!isStreaming}
        />
        <TouchableOpacity
          style={[
            styles.sendBtn,
            (!message.trim() || isStreaming) && styles.sendBtnDisabled,
          ]}
          onPress={sendMessage}
          disabled={!message.trim() || isStreaming}
          activeOpacity={0.8}
        >
          <Feather name="send" size={18} color={message.trim() && !isStreaming ? "#0A0A0A" : "#555"} />
        </TouchableOpacity>
      </View>

      <TopUpModal
        visible={showTopUpModal}
        onClose={() => setShowTopUpModal(false)}
        onSuccess={() => {
          setInsufficientBalance(false);
          refetchWallet();
          queryClient.invalidateQueries({ queryKey: ["wallet"] });
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0A0A0A",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
  },
  headerTitle: {
    fontSize: 26,
    fontFamily: "Inter_700Bold",
    color: Colors.gold,
    letterSpacing: -0.5,
  },
  headerSub: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: "#8A8A8A",
    marginTop: 2,
  },
  usageBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1A1A1A",
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  usageText: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
  },
  warningBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#1F1A00",
    borderColor: "#F59E0B44",
    borderWidth: 1,
    borderRadius: 10,
    marginHorizontal: 16,
    marginBottom: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  warningText: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: "#F59E0B",
    flex: 1,
  },
  warningLink: {
    fontFamily: "Inter_600SemiBold",
    textDecorationLine: "underline",
  },
  insufficientBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#1F1111",
    borderColor: "#EF444444",
    borderWidth: 1,
    borderRadius: 10,
    marginHorizontal: 16,
    marginBottom: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  insufficientText: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: "#EF4444",
    flex: 1,
  },
  insufficientLink: {
    fontFamily: "Inter_600SemiBold",
    textDecorationLine: "underline",
  },
  modeScroll: {
    maxHeight: 48,
    marginTop: 4,
  },
  modeScrollContent: {
    paddingHorizontal: 16,
    gap: 8,
    flexDirection: "row",
    alignItems: "center",
  },
  modeChip: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1A1A1A",
    borderColor: "#2A2A2A",
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 7,
    gap: 6,
  },
  modeChipText: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    color: "#FFFFFF",
  },
  chatArea: {
    flex: 1,
    marginTop: 8,
  },
  chatContent: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    gap: 12,
  },
  bubble: {
    maxWidth: "85%",
    borderRadius: 16,
    padding: 12,
  },
  userBubble: {
    alignSelf: "flex-end",
    backgroundColor: Colors.gold,
  },
  assistantBubble: {
    alignSelf: "flex-start",
    backgroundColor: "#1A1A1A",
    borderColor: "#2A2A2A",
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  typingBubble: {
    alignItems: "center",
  },
  assistantIcon: {
    marginTop: 2,
  },
  bubbleText: {
    fontSize: 15,
    lineHeight: 22,
  },
  userBubbleText: {
    fontFamily: "Inter_400Regular",
    color: "#0A0A0A",
  },
  assistantBubbleText: {
    fontFamily: "Inter_400Regular",
    color: "#FFFFFF",
    flex: 1,
  },
  typingDots: {
    flexDirection: "row",
    gap: 4,
    alignItems: "center",
    paddingVertical: 2,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.gold,
  },
  inputBar: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    borderTopColor: "#2A2A2A",
    borderTopWidth: StyleSheet.hairlineWidth,
    backgroundColor: "#0A0A0A",
  },
  input: {
    flex: 1,
    backgroundColor: "#1A1A1A",
    borderColor: "#2A2A2A",
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    color: "#FFFFFF",
    maxHeight: 120,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.gold,
    justifyContent: "center",
    alignItems: "center",
  },
  sendBtnDisabled: {
    backgroundColor: "#2A2A2A",
  },
});
