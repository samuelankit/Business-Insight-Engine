import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
  TextInput,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useQuery, useMutation } from "@tanstack/react-query";
import Colors from "@/constants/colors";
import { useApp } from "@/context/AppContext";

const C = Colors.dark;

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
}

export default function DashboardScreen() {
  const { userId, activeBusinessId, token } = useApp();
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      role: "assistant",
      content: "Welcome to GoRigo! I'm your AI business assistant. Ask me anything about your business, or choose a mode below to get started.",
    },
  ]);
  const [refreshing, setRefreshing] = useState(false);

  const { data: usageData } = useQuery({
    queryKey: ["usage", userId],
    queryFn: async () => {
      if (!token) return null;
      const domain = process.env["EXPO_PUBLIC_DOMAIN"];
      const resp = await fetch(`https://${domain}/api/usage/summary`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return resp.ok ? resp.json() : null;
    },
    enabled: !!token,
  });

  const orchestrateMutation = useMutation({
    mutationFn: async (msg: string) => {
      if (!token || !activeBusinessId) throw new Error("Not authenticated");
      const domain = process.env["EXPO_PUBLIC_DOMAIN"];
      const resp = await fetch(`https://${domain}/api/orchestrate`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ message: msg, businessId: activeBusinessId }),
      });
      if (!resp.ok) throw new Error("Failed to send");
      return resp.json();
    },
    onSuccess: (data) => {
      setMessages((prev) => [
        ...prev,
        { id: Date.now().toString(), role: "assistant", content: data.response },
      ]);
    },
    onError: () => {
      setMessages((prev) => [
        ...prev,
        { id: Date.now().toString(), role: "assistant", content: "Sorry, I had trouble connecting. Please check your API key in Settings." },
      ]);
    },
  });

  const sendMessage = useCallback(() => {
    const trimmed = message.trim();
    if (!trimmed || orchestrateMutation.isPending) return;
    setMessages((prev) => [
      ...prev,
      { id: Date.now().toString(), role: "user", content: trimmed },
    ]);
    setMessage("");
    orchestrateMutation.mutate(trimmed);
  }, [message, orchestrateMutation]);

  const modes = [
    { id: "deep_research", label: "Deep Research", icon: "search" as const },
    { id: "strategy_swot", label: "Strategy SWOT", icon: "target" as const },
    { id: "brainstorm", label: "Brainstorm", icon: "zap" as const },
    { id: "business_plan", label: "Business Plan", icon: "file-text" as const },
  ];

  const handleMode = (modeId: string, label: string) => {
    const prompt = `Start a ${label} session for my business.`;
    setMessages((prev) => [
      ...prev,
      { id: Date.now().toString(), role: "user", content: prompt },
    ]);
    orchestrateMutation.mutate(prompt);
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 800);
  }, []);

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>GoRigo</Text>
          <Text style={styles.headerSub}>AI Business OS</Text>
        </View>
        {usageData && (
          <View style={styles.usageBadge}>
            <Text style={styles.usageText}>
              {usageData.eventsUsed}/{usageData.eventsLimit === -1 ? "∞" : usageData.eventsLimit}
            </Text>
          </View>
        )}
      </View>

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
          >
            <Feather name={m.icon} size={14} color={Colors.gold} />
            <Text style={styles.modeChipText}>{m.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Chat area */}
      <ScrollView
        style={styles.chatArea}
        contentContainerStyle={styles.chatContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.gold} />}
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
                msg.role === "user" ? styles.userBubbleText : styles.assistantBubbleText,
              ]}
            >
              {msg.content}
            </Text>
          </View>
        ))}
        {orchestrateMutation.isPending && (
          <View style={[styles.bubble, styles.assistantBubble]}>
            <Text style={styles.assistantBubbleText}>Thinking...</Text>
          </View>
        )}
      </ScrollView>

      {/* Input bar */}
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
        />
        <TouchableOpacity
          style={[
            styles.sendBtn,
            (!message.trim() || orchestrateMutation.isPending) && styles.sendBtnDisabled,
          ]}
          onPress={sendMessage}
          disabled={!message.trim() || orchestrateMutation.isPending}
          activeOpacity={0.8}
        >
          <Feather name="send" size={18} color={message.trim() ? "#0A0A0A" : "#555"} />
        </TouchableOpacity>
      </View>
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
    backgroundColor: "#1A1A1A",
    borderColor: "#2A2A2A",
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  usageText: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    color: Colors.gold,
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
