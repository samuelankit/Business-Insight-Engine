import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
  Modal,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import Colors from "@/constants/colors";
import { useApp } from "@/context/AppContext";

const GOLD = Colors.gold;

interface ToolDef {
  name: string;
  label: string;
  description: string;
  credentialType: "oauth2" | "api_key";
  oauthProvider?: string;
  functions: string[];
  isConnected: boolean;
  connectionId: string | null;
  tokenExpiresAt: string | null;
  nearingExpiry: boolean;
}

const TOOL_ICONS: Record<string, string> = {
  gmail: "mail",
  google_calendar: "calendar",
  google_sheets: "grid",
  notion: "book-open",
  slack: "message-square",
  xero: "briefcase",
  stripe: "credit-card",
  trello: "layout",
  facebook: "globe",
  linkedin: "user",
};

const TOOL_COLORS: Record<string, string> = {
  gmail: "#EA4335",
  google_calendar: "#1A73E8",
  google_sheets: "#34A853",
  notion: "#FFFFFF",
  slack: "#4A154B",
  xero: "#13B5EA",
  stripe: "#635BFF",
  trello: "#0052CC",
  facebook: "#1877F2",
  linkedin: "#0A66C2",
};

const PERMISSIONS: Record<string, string[]> = {
  google: [
    "Read your Gmail inbox messages",
    "View your Google Calendar events",
    "Read data from your Google Sheets",
  ],
  notion: ["Search and read your Notion pages and databases"],
  slack: ["Read your Slack channel list", "Send messages to channels on your behalf"],
  xero: ["View your Xero organisation details", "Read your invoices and accounting data"],
  facebook: ["View your Facebook Pages", "Read recent posts on your Pages"],
  linkedin: ["Read your LinkedIn profile information"],
};

export default function ToolsScreen() {
  const router = useRouter();
  const { token, userId } = useApp();
  const queryClient = useQueryClient();

  const [connectingTool, setConnectingTool] = useState<ToolDef | null>(null);
  const [showPermissions, setShowPermissions] = useState<ToolDef | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [trelloKeyInput, setTrelloKeyInput] = useState("");
  const [trelloTokenInput, setTrelloTokenInput] = useState("");
  const [testingConnection, setTestingConnection] = useState(false);
  const [testResult, setTestResult] = useState<"idle" | "success" | "error">("idle");
  const [testError, setTestError] = useState("");
  const [savingKey, setSavingKey] = useState(false);

  const apiBase = `https://${process.env["EXPO_PUBLIC_DOMAIN"]}/api`;
  const headers = { Authorization: `Bearer ${token ?? ""}`, "Content-Type": "application/json" };

  const { data: tools = [], isLoading, refetch } = useQuery<ToolDef[]>({
    queryKey: ["tools", userId],
    queryFn: async () => {
      const resp = await fetch(`${apiBase}/tools/available`, { headers });
      return resp.ok ? resp.json() : [];
    },
    enabled: !!token,
  });

  const connectedCount = tools.filter((t) => t.isConnected).length;

  const handleDisconnect = (tool: ToolDef) => {
    Alert.alert(
      `Disconnect ${tool.label}`,
      `This will revoke GoRigo's access to your ${tool.label} account and remove the connection. You can reconnect at any time.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Disconnect",
          style: "destructive",
          onPress: async () => {
            try {
              await fetch(`${apiBase}/tools/connections/${tool.connectionId}`, {
                method: "DELETE",
                headers,
              });
              await refetch();
              queryClient.invalidateQueries({ queryKey: ["tools"] });
            } catch {
              Alert.alert("Error", "Failed to disconnect. Please try again.");
            }
          },
        },
      ],
    );
  };

  const handleToolPress = (tool: ToolDef) => {
    if (tool.isConnected) {
      handleDisconnect(tool);
    } else if (tool.credentialType === "api_key") {
      setApiKeyInput("");
      setTrelloKeyInput("");
      setTrelloTokenInput("");
      setTestResult("idle");
      setTestError("");
      setConnectingTool(tool);
    } else {
      setShowPermissions(tool);
    }
  };

  const handleOAuthConnect = async (tool: ToolDef) => {
    setShowPermissions(null);
    try {
      const oauthProvider = tool.oauthProvider;
      const startResp = await fetch(`${apiBase}/tools/oauth/${oauthProvider}/start`, { headers });
      if (!startResp.ok) {
        const err = await startResp.json() as { error?: string };
        Alert.alert("Configuration Error", err.error ?? "OAuth not configured. Please contact support.");
        return;
      }
      const { authUrl } = await startResp.json() as { authUrl: string };
      const result = await WebBrowser.openAuthSessionAsync(authUrl, "gorigo://oauth-callback");
      if (result.type === "success") {
        await refetch();
        queryClient.invalidateQueries({ queryKey: ["tools"] });
      }
    } catch {
      Alert.alert("Error", "Failed to start OAuth flow. Please try again.");
    }
  };

  const handleTestAndSave = async () => {
    if (!connectingTool) return;
    const toolName = connectingTool.name;

    let credentials: string;
    if (toolName === "trello") {
      if (!trelloKeyInput.trim() || !trelloTokenInput.trim()) {
        Alert.alert("Required", "Both API Key and Token are required for Trello.");
        return;
      }
      credentials = JSON.stringify({ trelloKey: trelloKeyInput.trim(), trelloToken: trelloTokenInput.trim() });
    } else {
      if (!apiKeyInput.trim()) {
        Alert.alert("Required", "Please enter your API key.");
        return;
      }
      credentials = JSON.stringify({ apiKey: apiKeyInput.trim() });
    }

    setTestingConnection(true);
    setTestResult("idle");
    let connectionId: string | null = null;
    try {
      const saveResp = await fetch(`${apiBase}/tools/connections`, {
        method: "POST",
        headers,
        body: JSON.stringify({ toolName, credentials }),
      });
      if (!saveResp.ok) throw new Error("Failed to save credentials");
      const saveData = await saveResp.json() as { id?: string };
      connectionId = saveData.id ?? null;

      const testResp = await fetch(`${apiBase}/tools/test`, {
        method: "POST",
        headers,
        body: JSON.stringify({ toolName, connectionId }),
      });
      const testData = await testResp.json() as { success: boolean; error?: string };

      if (testData.success) {
        setTestResult("success");
        setTimeout(async () => {
          setConnectingTool(null);
          await refetch();
          queryClient.invalidateQueries({ queryKey: ["tools"] });
        }, 1200);
      } else {
        setTestResult("error");
        setTestError(testData.error ?? "Connection test failed. Check your credentials.");
        if (connectionId) {
          await fetch(`${apiBase}/tools/connections/${connectionId}`, { method: "DELETE", headers });
        }
      }
    } catch (e) {
      setTestResult("error");
      setTestError(e instanceof Error ? e.message : "Connection failed");
      if (connectionId) {
        await fetch(`${apiBase}/tools/connections/${connectionId}`, { method: "DELETE", headers });
      }
    } finally {
      setTestingConnection(false);
    }
  };

  const resetApiKeyModal = () => {
    setConnectingTool(null);
    setApiKeyInput("");
    setTrelloKeyInput("");
    setTrelloTokenInput("");
    setTestResult("idle");
    setTestError("");
  };

  const getIconName = (toolName: string): any => {
    return TOOL_ICONS[toolName] ?? "tool";
  };

  const getToolColor = (toolName: string) => {
    return TOOL_COLORS[toolName] ?? "#555";
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Feather name="arrow-left" size={20} color="#FFFFFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Tools & Integrations</Text>
        <View style={styles.countBadge}>
          <Text style={styles.countText}>{connectedCount} connected</Text>
        </View>
      </View>

      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={GOLD} />
        </View>
      ) : (
        <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
          <Text style={styles.introText}>
            Connect your business tools so GoRigo agents can take action on your behalf.
          </Text>

          {tools.map((tool) => (
            <TouchableOpacity
              key={tool.name}
              style={[
                styles.toolCard,
                tool.isConnected && styles.toolCardConnected,
                tool.nearingExpiry && styles.toolCardWarning,
              ]}
              onPress={() => handleToolPress(tool)}
              activeOpacity={0.8}
            >
              <View style={[styles.toolIconWrap, { backgroundColor: getToolColor(tool.name) + "22" }]}>
                <Feather name={getIconName(tool.name)} size={22} color={getToolColor(tool.name)} />
              </View>
              <View style={styles.toolInfo}>
                <View style={styles.toolTitleRow}>
                  <Text style={styles.toolName}>{tool.label}</Text>
                  {tool.nearingExpiry && (
                    <View style={styles.expiryBadge}>
                      <Feather name="alert-triangle" size={10} color="#F59E0B" />
                      <Text style={styles.expiryText}>Expiring soon</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.toolDesc} numberOfLines={2}>{tool.description}</Text>
              </View>
              <View style={styles.toolStatus}>
                {tool.isConnected ? (
                  <View style={styles.connectedBadge}>
                    <Feather name="check-circle" size={14} color="#22C55E" />
                    <Text style={styles.connectedText}>Connected</Text>
                  </View>
                ) : (
                  <View style={styles.connectBadge}>
                    <Text style={styles.connectText}>Connect</Text>
                  </View>
                )}
              </View>
            </TouchableOpacity>
          ))}

          <View style={{ height: 32 }} />
        </ScrollView>
      )}

      {/* Permissions Disclosure Modal */}
      <Modal
        visible={!!showPermissions}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowPermissions(null)}
      >
        {showPermissions && (
          <SafeAreaView style={styles.modal}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Before you connect</Text>
              <TouchableOpacity onPress={() => setShowPermissions(null)}>
                <Feather name="x" size={22} color="#FFFFFF" />
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.modalContent}>
              <View style={[styles.toolIconWrapLarge, { backgroundColor: getToolColor(showPermissions.name) + "22" }]}>
                <Feather name={getIconName(showPermissions.name)} size={32} color={getToolColor(showPermissions.name)} />
              </View>
              <Text style={styles.permTitle}>
                Connect {showPermissions.label}
              </Text>
              <Text style={styles.permSubtitle}>
                GoRigo will be able to:
              </Text>
              {(PERMISSIONS[showPermissions.oauthProvider ?? ""] ?? showPermissions.functions).map((perm, i) => (
                <View key={i} style={styles.permRow}>
                  <Feather name="check" size={14} color={GOLD} style={{ marginTop: 2 }} />
                  <Text style={styles.permText}>{perm}</Text>
                </View>
              ))}
              <View style={styles.permNotice}>
                <Feather name="shield" size={14} color={GOLD} />
                <Text style={styles.permNoticeText}>
                  Your credentials are encrypted and stored securely. GoRigo never sells your data. You can disconnect at any time.
                </Text>
              </View>
              <View style={styles.permLegal}>
                <Text style={styles.permLegalText}>
                  This connection is required by GDPR and Google's OAuth policy to inform you of the access being requested.
                </Text>
              </View>
            </ScrollView>
            <View style={styles.modalFooter}>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => setShowPermissions(null)}
              >
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.saveBtn}
                onPress={() => handleOAuthConnect(showPermissions)}
              >
                <Text style={styles.saveBtnText}>Authorise in Browser</Text>
              </TouchableOpacity>
            </View>
          </SafeAreaView>
        )}
      </Modal>

      {/* API Key Bottom Sheet */}
      <Modal
        visible={!!connectingTool}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={resetApiKeyModal}
      >
        {connectingTool && (
          <SafeAreaView style={styles.modal}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Connect {connectingTool.label}</Text>
              <TouchableOpacity onPress={resetApiKeyModal}>
                <Feather name="x" size={22} color="#FFFFFF" />
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.modalContent} keyboardShouldPersistTaps="handled">
              {connectingTool.name === "trello" ? (
                <>
                  <Text style={styles.fieldLabel}>Trello API Key</Text>
                  <TextInput
                    style={styles.textInput}
                    value={trelloKeyInput}
                    onChangeText={setTrelloKeyInput}
                    placeholder="Your Trello API key"
                    placeholderTextColor="#555"
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                  <Text style={styles.fieldLabel}>Trello Token</Text>
                  <TextInput
                    style={styles.textInput}
                    value={trelloTokenInput}
                    onChangeText={setTrelloTokenInput}
                    placeholder="Your Trello token"
                    placeholderTextColor="#555"
                    autoCapitalize="none"
                    autoCorrect={false}
                    secureTextEntry
                  />
                  <Text style={styles.fieldHint}>
                    Find your API key at trello.com/app-key and generate a token from there.
                  </Text>
                </>
              ) : (
                <>
                  <Text style={styles.fieldLabel}>
                    {connectingTool.name === "stripe" ? "Stripe Secret Key" : "API Key"}
                  </Text>
                  <TextInput
                    style={styles.textInput}
                    value={apiKeyInput}
                    onChangeText={setApiKeyInput}
                    placeholder={connectingTool.name === "stripe" ? "sk_live_..." : "Your API key"}
                    placeholderTextColor="#555"
                    autoCapitalize="none"
                    autoCorrect={false}
                    secureTextEntry
                  />
                  {connectingTool.name === "stripe" && (
                    <Text style={styles.fieldHint}>
                      Use your Stripe secret key (starts with sk_live_ or sk_test_). Found in Dashboard → Developers → API keys.
                    </Text>
                  )}
                </>
              )}

              {testResult === "success" && (
                <View style={styles.testSuccess}>
                  <Feather name="check-circle" size={16} color="#22C55E" />
                  <Text style={styles.testSuccessText}>Connection verified!</Text>
                </View>
              )}
              {testResult === "error" && (
                <View style={styles.testError}>
                  <Feather name="alert-circle" size={16} color="#EF4444" />
                  <Text style={styles.testErrorText}>{testError || "Connection failed. Check your credentials."}</Text>
                </View>
              )}

              <View style={styles.securityNote}>
                <Feather name="lock" size={14} color={GOLD} />
                <Text style={styles.securityText}>
                  Your API key is encrypted with envelope encryption before storage. Only you can access it.
                </Text>
              </View>
            </ScrollView>
            <View style={styles.modalFooter}>
              <TouchableOpacity
                style={[styles.saveBtn, testingConnection && styles.saveBtnDisabled]}
                onPress={handleTestAndSave}
                disabled={testingConnection}
              >
                {testingConnection ? (
                  <ActivityIndicator size="small" color="#0A0A0A" />
                ) : (
                  <Text style={styles.saveBtnText}>Test & Connect</Text>
                )}
              </TouchableOpacity>
            </View>
          </SafeAreaView>
        )}
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0A0A0A" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 16,
    gap: 12,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#1A1A1A",
    justifyContent: "center",
    alignItems: "center",
  },
  headerTitle: {
    flex: 1,
    fontSize: 20,
    fontFamily: "Inter_700Bold",
    color: "#FFFFFF",
    letterSpacing: -0.3,
  },
  countBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: "#1A1A1A",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#2A2A2A",
  },
  countText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#8A8A8A" },
  loadingContainer: { flex: 1, justifyContent: "center", alignItems: "center" },
  scroll: { flex: 1, paddingHorizontal: 20 },
  introText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: "#8A8A8A",
    marginBottom: 20,
    lineHeight: 20,
  },
  toolCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1A1A1A",
    borderColor: "#2A2A2A",
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    gap: 12,
  },
  toolCardConnected: {
    borderColor: "#22C55E44",
    backgroundColor: "#0A1A10",
  },
  toolCardWarning: {
    borderColor: "#F59E0B44",
    backgroundColor: "#1A1500",
  },
  toolIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
  },
  toolIconWrapLarge: {
    width: 72,
    height: 72,
    borderRadius: 18,
    justifyContent: "center",
    alignItems: "center",
    alignSelf: "center",
    marginBottom: 16,
    marginTop: 8,
  },
  toolInfo: { flex: 1 },
  toolTitleRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 },
  toolName: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#FFFFFF" },
  toolDesc: { fontSize: 12, fontFamily: "Inter_400Regular", color: "#8A8A8A", lineHeight: 16 },
  toolStatus: { alignItems: "flex-end" },
  connectedBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: "#22C55E18",
    borderRadius: 8,
  },
  connectedText: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: "#22C55E" },
  connectBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: GOLD + "22",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: GOLD + "44",
  },
  connectText: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: GOLD },
  expiryBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    backgroundColor: "#F59E0B22",
    borderRadius: 6,
  },
  expiryText: { fontSize: 10, fontFamily: "Inter_600SemiBold", color: "#F59E0B" },
  modal: { flex: 1, backgroundColor: "#0A0A0A" },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#1A1A1A",
  },
  modalTitle: { fontSize: 18, fontFamily: "Inter_700Bold", color: "#FFFFFF" },
  modalContent: { flex: 1, paddingHorizontal: 20, paddingTop: 20 },
  modalFooter: {
    flexDirection: "row",
    padding: 20,
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: "#1A1A1A",
  },
  permTitle: {
    fontSize: 22,
    fontFamily: "Inter_700Bold",
    color: "#FFFFFF",
    textAlign: "center",
    marginBottom: 8,
  },
  permSubtitle: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
    color: "#8A8A8A",
    marginBottom: 16,
  },
  permRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    marginBottom: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: "#1A1A1A",
    borderRadius: 10,
  },
  permText: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular", color: "#DDDDDD", lineHeight: 20 },
  permNotice: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    marginTop: 16,
    padding: 12,
    backgroundColor: GOLD + "18",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: GOLD + "33",
  },
  permNoticeText: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", color: "#DDDDDD", lineHeight: 18 },
  permLegal: { marginTop: 12, marginBottom: 8 },
  permLegalText: { fontSize: 11, fontFamily: "Inter_400Regular", color: "#555", lineHeight: 16 },
  fieldLabel: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#AAAAAA", marginBottom: 8, marginTop: 4 },
  fieldHint: { fontSize: 12, fontFamily: "Inter_400Regular", color: "#666", marginTop: 8, marginBottom: 16, lineHeight: 16 },
  textInput: {
    backgroundColor: "#1A1A1A",
    borderWidth: 1,
    borderColor: "#2A2A2A",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: "#FFFFFF",
    marginBottom: 16,
  },
  testSuccess: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 12,
    backgroundColor: "#22C55E18",
    borderRadius: 10,
    marginBottom: 12,
  },
  testSuccessText: { fontSize: 14, fontFamily: "Inter_500Medium", color: "#22C55E" },
  testError: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    padding: 12,
    backgroundColor: "#EF444418",
    borderRadius: 10,
    marginBottom: 12,
  },
  testErrorText: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", color: "#EF4444", lineHeight: 18 },
  securityNote: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    padding: 12,
    backgroundColor: GOLD + "18",
    borderRadius: 10,
    marginTop: 4,
    borderWidth: 1,
    borderColor: GOLD + "33",
  },
  securityText: { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", color: "#AAAAAA", lineHeight: 16 },
  saveBtn: {
    flex: 1,
    backgroundColor: GOLD,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 48,
  },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#0A0A0A" },
  cancelBtn: {
    flex: 0.4,
    backgroundColor: "#1A1A1A",
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#2A2A2A",
  },
  cancelBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#AAAAAA" },
});
