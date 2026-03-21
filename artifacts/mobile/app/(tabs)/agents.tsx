import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Switch,
  Alert,
  Modal,
  TextInput,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Colors from "@/constants/colors";
import { useApp } from "@/context/AppContext";

const C = Colors.dark;
const GOLD = Colors.gold;

interface Agent {
  id: string;
  name: string;
  description?: string;
  type: string;
  isActive: boolean;
  lastRunAt?: string | null;
  scheduleType: string;
}

interface AgentTemplate {
  id: string;
  name: string;
  description: string;
  type: string;
}

export default function AgentsScreen() {
  const { token, activeBusinessId } = useApp();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPrompt, setNewPrompt] = useState("");

  const apiBase = `https://${process.env["EXPO_PUBLIC_DOMAIN"]}/api`;
  const headers = { Authorization: `Bearer ${token ?? ""}`, "Content-Type": "application/json" };

  const { data: agents = [], isLoading } = useQuery<Agent[]>({
    queryKey: ["agents", activeBusinessId],
    queryFn: async () => {
      if (!activeBusinessId) return [];
      const resp = await fetch(`${apiBase}/agents?businessId=${activeBusinessId}`, { headers });
      return resp.ok ? resp.json() : [];
    },
    enabled: !!token && !!activeBusinessId,
  });

  const { data: templates = [] } = useQuery<AgentTemplate[]>({
    queryKey: ["agent-templates"],
    queryFn: async () => {
      const resp = await fetch(`${apiBase}/agents/templates`, { headers });
      return resp.ok ? resp.json() : [];
    },
    enabled: !!token,
  });

  const { data: pendingActions = [] } = useQuery<any[]>({
    queryKey: ["pending-actions", activeBusinessId],
    queryFn: async () => {
      if (!activeBusinessId) return [];
      const resp = await fetch(`${apiBase}/agents/approvals/pending?businessId=${activeBusinessId}`, { headers });
      return resp.ok ? resp.json() : [];
    },
    enabled: !!token && !!activeBusinessId,
    refetchInterval: 30_000,
  });

  const toggleAgent = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      const resp = await fetch(`${apiBase}/agents/${id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ isActive }),
      });
      return resp.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["agents"] }),
  });

  const runAgent = useMutation({
    mutationFn: async (agentId: string) => {
      const resp = await fetch(`${apiBase}/agents/${agentId}/run`, {
        method: "POST",
        headers,
        body: JSON.stringify({ businessId: activeBusinessId }),
      });
      return resp.json();
    },
    onSuccess: (data) => {
      Alert.alert("Agent Run Complete", data.summary ?? "Run completed successfully.");
      queryClient.invalidateQueries({ queryKey: ["agents"] });
    },
  });

  const createAgent = useMutation({
    mutationFn: async () => {
      const resp = await fetch(`${apiBase}/agents`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          businessId: activeBusinessId,
          name: newName,
          systemPrompt: newPrompt,
        }),
      });
      return resp.json();
    },
    onSuccess: () => {
      setShowCreate(false);
      setNewName("");
      setNewPrompt("");
      queryClient.invalidateQueries({ queryKey: ["agents"] });
    },
  });

  const approveAction = useMutation({
    mutationFn: async (actionId: string) => {
      const resp = await fetch(`${apiBase}/agents/approvals/${actionId}/approve`, {
        method: "POST",
        headers,
      });
      return resp.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["pending-actions"] }),
  });

  const rejectAction = useMutation({
    mutationFn: async (actionId: string) => {
      const resp = await fetch(`${apiBase}/agents/approvals/${actionId}/reject`, {
        method: "POST",
        headers,
      });
      return resp.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["pending-actions"] }),
  });

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>AI Agents</Text>
        <TouchableOpacity style={styles.addBtn} onPress={() => setShowCreate(true)}>
          <Feather name="plus" size={18} color="#0A0A0A" />
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Pending approvals */}
        {pendingActions.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Pending Approval</Text>
            {pendingActions.map((action) => (
              <View key={action.id} style={styles.approvalCard}>
                <View style={styles.approvalIcon}>
                  <Feather name="alert-circle" size={18} color={Colors.dark.warning} />
                </View>
                <View style={styles.approvalInfo}>
                  <Text style={styles.approvalTool}>{action.toolName} › {action.functionName}</Text>
                  <Text style={styles.approvalDesc}>{action.actionDescription}</Text>
                </View>
                <View style={styles.approvalButtons}>
                  <TouchableOpacity
                    style={[styles.approvalBtn, styles.rejectBtn]}
                    onPress={() => rejectAction.mutate(action.id)}
                  >
                    <Feather name="x" size={14} color="#EF4444" />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.approvalBtn, styles.approveBtn]}
                    onPress={() => approveAction.mutate(action.id)}
                  >
                    <Feather name="check" size={14} color="#22C55E" />
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </View>
        )}

        {/* My agents */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>My Agents</Text>
          {isLoading ? (
            <Text style={styles.emptyText}>Loading agents...</Text>
          ) : agents.length === 0 ? (
            <View style={styles.emptyCard}>
              <Feather name="cpu" size={32} color="#2A2A2A" />
              <Text style={styles.emptyText}>No agents yet</Text>
              <Text style={styles.emptySubtext}>Create an agent or start from a template below</Text>
            </View>
          ) : (
            agents.map((agent) => (
              <View key={agent.id} style={styles.agentCard}>
                <View style={styles.agentLeft}>
                  <View style={styles.agentIconContainer}>
                    <Feather name="cpu" size={20} color={GOLD} />
                  </View>
                  <View style={styles.agentInfo}>
                    <Text style={styles.agentName}>{agent.name}</Text>
                    {agent.lastRunAt && (
                      <Text style={styles.agentMeta}>
                        Last run: {new Date(agent.lastRunAt).toLocaleDateString()}
                      </Text>
                    )}
                  </View>
                </View>
                <View style={styles.agentRight}>
                  <Switch
                    value={agent.isActive}
                    onValueChange={(v) => toggleAgent.mutate({ id: agent.id, isActive: v })}
                    trackColor={{ false: "#2A2A2A", true: GOLD + "66" }}
                    thumbColor={agent.isActive ? GOLD : "#555"}
                  />
                  <TouchableOpacity
                    style={styles.runBtn}
                    onPress={() => runAgent.mutate(agent.id)}
                    disabled={runAgent.isPending}
                  >
                    <Feather name="play" size={14} color={GOLD} />
                  </TouchableOpacity>
                </View>
              </View>
            ))
          )}
        </View>

        {/* Templates */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Templates</Text>
          {templates.map((template) => (
            <TouchableOpacity
              key={template.id}
              style={styles.templateCard}
              onPress={() => {
                setNewName(template.name);
                setNewPrompt(template.systemPrompt ?? "");
                setShowCreate(true);
              }}
              activeOpacity={0.7}
            >
              <View style={styles.templateIcon}>
                <Feather name="zap" size={18} color={GOLD} />
              </View>
              <View style={styles.templateInfo}>
                <Text style={styles.templateName}>{template.name}</Text>
                <Text style={styles.templateDesc} numberOfLines={2}>{template.description}</Text>
              </View>
              <Feather name="chevron-right" size={16} color="#555" />
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>

      {/* Create Agent Modal */}
      <Modal visible={showCreate} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={styles.modal}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Create Agent</Text>
            <TouchableOpacity onPress={() => setShowCreate(false)}>
              <Feather name="x" size={22} color="#FFFFFF" />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.modalContent}>
            <Text style={styles.fieldLabel}>Agent Name</Text>
            <TextInput
              style={styles.textInput}
              value={newName}
              onChangeText={setNewName}
              placeholder="e.g. Marketing Agent"
              placeholderTextColor="#555"
            />

            <Text style={styles.fieldLabel}>System Prompt</Text>
            <TextInput
              style={[styles.textInput, styles.textInputTall]}
              value={newPrompt}
              onChangeText={setNewPrompt}
              placeholder="Describe what this agent should do..."
              placeholderTextColor="#555"
              multiline
            />
          </ScrollView>

          <View style={styles.modalFooter}>
            <TouchableOpacity
              style={[styles.createBtn, (!newName.trim() || !newPrompt.trim()) && styles.createBtnDisabled]}
              onPress={() => createAgent.mutate()}
              disabled={!newName.trim() || !newPrompt.trim() || createAgent.isPending}
            >
              <Text style={styles.createBtnText}>
                {createAgent.isPending ? "Creating..." : "Create Agent"}
              </Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0A0A0A" },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 16,
  },
  headerTitle: {
    fontSize: 24,
    fontFamily: "Inter_700Bold",
    color: "#FFFFFF",
    letterSpacing: -0.5,
  },
  addBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: Colors.gold,
    justifyContent: "center",
    alignItems: "center",
  },
  scroll: { flex: 1 },
  section: { paddingHorizontal: 20, marginBottom: 24 },
  sectionTitle: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    color: "#8A8A8A",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 12,
  },
  approvalCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1A1A1A",
    borderColor: "#F59E0B44",
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    gap: 12,
  },
  approvalIcon: { width: 32, height: 32, justifyContent: "center", alignItems: "center" },
  approvalInfo: { flex: 1 },
  approvalTool: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#F59E0B", marginBottom: 2 },
  approvalDesc: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#8A8A8A" },
  approvalButtons: { flexDirection: "row", gap: 8 },
  approvalBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
  },
  rejectBtn: { borderColor: "#EF444444", backgroundColor: "#1A1A1A" },
  approveBtn: { borderColor: "#22C55E44", backgroundColor: "#1A1A1A" },
  agentCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1A1A1A",
    borderColor: "#2A2A2A",
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    marginBottom: 10,
  },
  agentLeft: { flex: 1, flexDirection: "row", alignItems: "center", gap: 12 },
  agentIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.goldMuted,
    justifyContent: "center",
    alignItems: "center",
  },
  agentInfo: { flex: 1 },
  agentName: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#FFFFFF" },
  agentMeta: { fontSize: 12, fontFamily: "Inter_400Regular", color: "#8A8A8A", marginTop: 2 },
  agentRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  runBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Colors.goldMuted,
    justifyContent: "center",
    alignItems: "center",
  },
  emptyCard: {
    alignItems: "center",
    paddingVertical: 40,
    gap: 8,
  },
  emptyText: { fontSize: 15, fontFamily: "Inter_500Medium", color: "#555" },
  emptySubtext: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#444", textAlign: "center", paddingHorizontal: 40 },
  templateCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1A1A1A",
    borderColor: "#2A2A2A",
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    gap: 12,
  },
  templateIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.goldMuted,
    justifyContent: "center",
    alignItems: "center",
  },
  templateInfo: { flex: 1 },
  templateName: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#FFFFFF", marginBottom: 2 },
  templateDesc: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#8A8A8A" },
  modal: { flex: 1, backgroundColor: "#0A0A0A" },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomColor: "#2A2A2A",
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  modalTitle: { fontSize: 18, fontFamily: "Inter_700Bold", color: "#FFFFFF" },
  modalContent: { flex: 1, padding: 20 },
  fieldLabel: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    color: "#8A8A8A",
    marginBottom: 8,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  textInput: {
    backgroundColor: "#1A1A1A",
    borderColor: "#2A2A2A",
    borderWidth: 1,
    borderRadius: 10,
    padding: 14,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    color: "#FFFFFF",
    marginBottom: 20,
  },
  textInputTall: { height: 140, textAlignVertical: "top" },
  modalFooter: { padding: 20, borderTopColor: "#2A2A2A", borderTopWidth: StyleSheet.hairlineWidth },
  createBtn: {
    backgroundColor: Colors.gold,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: "center",
  },
  createBtnDisabled: { opacity: 0.5 },
  createBtnText: { fontSize: 16, fontFamily: "Inter_700Bold", color: "#0A0A0A" },
});
