import React, { useState, useCallback, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  Modal,
  Share,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Colors from "@/constants/colors";
import { useApp } from "@/context/AppContext";

const GOLD = Colors.gold;
const C = Colors.dark;

const OPPORTUNITY_TYPES = ["Partnership", "Client", "Talent", "Supplier", "Collaboration"] as const;

type NetworkTab = "matches" | "incoming" | "pending" | "my-network";
type HandoffMode = "rigo" | "direct";

interface NetworkStatus {
  isPaid: boolean;
  isOptedIn: boolean;
  hasGdprConsent: boolean;
  hasCriteria: boolean;
}

interface NetworkMatch {
  id: string;
  matchedBusinessId: string;
  businessName: string;
  sector: string;
  matchReason: string;
  matchStrength: number;
  opportunityType: string;
}

interface PendingConnection {
  connectionId: string;
  status: string;
  opportunityType: string;
  receiverBusinessName: string;
  receiverSector: string;
  qualificationSummary: string | null;
  agentRecommendation: string | null;
  matchStrength: number;
  qualificationTranscript: Array<{ turn: number; question: string; response: string | null }>;
}

interface MyNetworkConnection {
  connectionId: string;
  otherBusinessName: string;
  otherSector: string;
  opportunityType: string;
  handoffMode: string | null;
  status: string;
  isRequester: boolean;
  followups: Array<{ id: string; promptText: string; scheduledAt: string; completedAt: string | null }>;
  connectedAt: string;
}

interface IncomingQualification {
  connectionId: string;
  opportunityType: string;
  requesterBusinessName: string;
  requesterSector: string;
  totalTurns: number;
  completedTurns: number;
  currentQuestion: string | null;
  currentTurnId: string | null;
}

interface QualificationState {
  connectionId: string;
  businessName: string;
  question: string;
  turnsRemaining: number;
  isComplete: boolean;
  summary?: string;
  recommendation?: string;
}

function MatchStrengthBar({ score }: { score: number }) {
  const color = score >= 80 ? "#22C55E" : score >= 60 ? GOLD : "#F59E0B";
  return (
    <View style={barStyles.container}>
      <View style={[barStyles.fill, { width: `${score}%` as `${number}%`, backgroundColor: color }]} />
    </View>
  );
}

const barStyles = StyleSheet.create({
  container: { height: 4, backgroundColor: "#2A2A2A", borderRadius: 2, marginTop: 6 },
  fill: { height: 4, borderRadius: 2 },
});

export default function NetworkScreen() {
  const { token, activeBusinessId } = useApp();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<NetworkTab>("matches");
  const [showGdprConsent, setShowGdprConsent] = useState(false);
  const [showCriteriaSetup, setShowCriteriaSetup] = useState(false);
  const [showDecisionModal, setShowDecisionModal] = useState(false);
  const [showHandoffModal, setShowHandoffModal] = useState(false);
  const [showQualificationModal, setShowQualificationModal] = useState(false);
  const [selectedIncoming, setSelectedIncoming] = useState<IncomingQualification | null>(null);
  const [selectedConnection, setSelectedConnection] = useState<PendingConnection | null>(null);
  const [handoffDecisionId, setHandoffDecisionId] = useState<string | null>(null);
  const [selectedHandoff, setSelectedHandoff] = useState<HandoffMode>("rigo");
  const [qualificationState, setQualificationState] = useState<QualificationState | null>(null);
  const [qualificationResponse, setQualificationResponse] = useState("");
  const [selectedOpportunityTypes, setSelectedOpportunityTypes] = useState<string[]>(["Partnership"]);
  const [sectorPrefs, setSectorPrefs] = useState("");
  const [mustHaves, setMustHaves] = useState("");
  const [dealBreakers, setDealBreakers] = useState("");
  const [introDraft, setIntroDraft] = useState<string | null>(null);
  const [introDraftConnectionId, setIntroDraftConnectionId] = useState<string | null>(null);

  const apiBase = `https://${process.env["EXPO_PUBLIC_DOMAIN"]}/api`;
  const headers = { Authorization: `Bearer ${token ?? ""}`, "Content-Type": "application/json" };

  useEffect(() => {
    if (!token || !activeBusinessId) return;
    fetch(`${apiBase}/networking/process-followups`, {
      method: "POST",
      headers,
      body: JSON.stringify({ businessId: activeBusinessId }),
    }).catch(() => {});
  }, [activeBusinessId, token]);

  const { data: status, isLoading: statusLoading } = useQuery<NetworkStatus>({
    queryKey: ["network-status", activeBusinessId],
    queryFn: async () => {
      if (!activeBusinessId) return { isPaid: false, isOptedIn: false, hasGdprConsent: false, hasCriteria: false };
      const resp = await fetch(`${apiBase}/networking/status?businessId=${activeBusinessId}`, { headers });
      return resp.ok ? resp.json() : { isPaid: false, isOptedIn: false, hasGdprConsent: false, hasCriteria: false };
    },
    enabled: !!token && !!activeBusinessId,
  });

  const { data: matches = [], isLoading: matchesLoading, refetch: refetchMatches } = useQuery<NetworkMatch[]>({
    queryKey: ["network-matches", activeBusinessId],
    queryFn: async () => {
      if (!activeBusinessId || !status?.isOptedIn) return [];
      const resp = await fetch(`${apiBase}/networking/matches?businessId=${activeBusinessId}`, { headers });
      if (resp.status === 403) return [];
      return resp.ok ? resp.json() : [];
    },
    enabled: !!token && !!activeBusinessId && !!status?.isOptedIn,
    staleTime: 60_000,
  });

  const { data: pending = [], isLoading: pendingLoading } = useQuery<PendingConnection[]>({
    queryKey: ["network-pending", activeBusinessId],
    queryFn: async () => {
      if (!activeBusinessId || !status?.isOptedIn) return [];
      const resp = await fetch(`${apiBase}/networking/pending?businessId=${activeBusinessId}`, { headers });
      if (resp.status === 403) return [];
      return resp.ok ? resp.json() : [];
    },
    enabled: !!token && !!activeBusinessId && !!status?.isOptedIn,
    refetchInterval: 30_000,
  });

  const { data: incoming = [], isLoading: incomingLoading, refetch: refetchIncoming } = useQuery<IncomingQualification[]>({
    queryKey: ["network-incoming", activeBusinessId],
    queryFn: async () => {
      if (!activeBusinessId || !status?.isOptedIn) return [];
      const resp = await fetch(`${apiBase}/networking/incoming?businessId=${activeBusinessId}`, { headers });
      if (resp.status === 403) return [];
      return resp.ok ? resp.json() : [];
    },
    enabled: !!token && !!activeBusinessId && !!status?.isOptedIn,
    refetchInterval: 30_000,
  });

  const { data: myNetwork = [], isLoading: networkLoading } = useQuery<MyNetworkConnection[]>({
    queryKey: ["network-my-network", activeBusinessId],
    queryFn: async () => {
      if (!activeBusinessId || !status?.isOptedIn) return [];
      const resp = await fetch(`${apiBase}/networking/my-network?businessId=${activeBusinessId}`, { headers });
      if (resp.status === 403) return [];
      return resp.ok ? resp.json() : [];
    },
    enabled: !!token && !!activeBusinessId && !!status?.isOptedIn,
  });

  const optIn = useMutation({
    mutationFn: async () => {
      const resp = await fetch(`${apiBase}/networking/opt-in`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          businessId: activeBusinessId,
          opportunityTypes: selectedOpportunityTypes,
          sectorPreferences: sectorPrefs ? sectorPrefs.split(",").map((s) => s.trim()) : [],
          mustHaves: mustHaves || null,
          dealBreakers: dealBreakers || null,
        }),
      });
      if (!resp.ok) throw new Error("Failed to opt in");
      return resp.json();
    },
    onSuccess: () => {
      setShowGdprConsent(false);
      setShowCriteriaSetup(false);
      queryClient.invalidateQueries({ queryKey: ["network-status"] });
      queryClient.invalidateQueries({ queryKey: ["network-matches"] });
    },
    onError: (err: Error) => Alert.alert("Error", err.message),
  });

  const sendConnect = useMutation({
    mutationFn: async ({ targetBusinessId, opportunityType, matchId }: { targetBusinessId: string; opportunityType: string; matchId: string }) => {
      const resp = await fetch(`${apiBase}/networking/connect`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          businessId: activeBusinessId,
          targetBusinessId,
          opportunityType,
          matchId,
        }),
      });
      if (!resp.ok) {
        const body = await resp.json();
        throw new Error(body.error ?? "Failed to send connection");
      }
      return resp.json() as Promise<{ connectionId: string; firstQuestion: string; costEstimate?: { maxTurns: number; estimatedAiEvents: number; estimatedTokens: number; note: string } }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["network-matches"] });
      queryClient.invalidateQueries({ queryKey: ["network-pending"] });
      const costNote = data.costEstimate?.note ?? "Rigo will run a qualification dialogue (max 5 turns) before this reaches the other business.";
      Alert.alert(
        "Request Sent",
        `Rigo has started the qualification process.\n\n${costNote}`,
        [{ text: "OK" }],
      );
    },
    onError: (err: Error) => Alert.alert("Error", err.message),
  });

  const submitDecision = useMutation({
    mutationFn: async ({ connectionId, decision }: { connectionId: string; decision: "accept" | "decline" }) => {
      const resp = await fetch(`${apiBase}/networking/connections/${connectionId}/decide`, {
        method: "POST",
        headers,
        body: JSON.stringify({ decision, handoffMode: decision === "accept" ? selectedHandoff : null }),
      });
      if (!resp.ok) throw new Error("Failed to submit decision");
      return resp.json();
    },
    onSuccess: () => {
      setShowDecisionModal(false);
      setShowHandoffModal(false);
      queryClient.invalidateQueries({ queryKey: ["network-pending"] });
      queryClient.invalidateQueries({ queryKey: ["network-my-network"] });
    },
    onError: (err: Error) => Alert.alert("Error", err.message),
  });

  const submitQualification = useMutation({
    mutationFn: async ({ connectionId, response }: { connectionId: string; response: string }) => {
      const resp = await fetch(`${apiBase}/networking/connections/${connectionId}/qualify`, {
        method: "POST",
        headers,
        body: JSON.stringify({ response }),
      });
      if (!resp.ok) throw new Error("Failed to submit response");
      return resp.json() as Promise<{ complete: boolean; nextQuestion?: string; turnsRemaining?: number; summary?: string; recommendation?: string }>;
    },
    onSuccess: (data) => {
      setQualificationResponse("");
      if (data.complete) {
        setQualificationState((prev) =>
          prev ? { ...prev, isComplete: true, summary: data.summary, recommendation: data.recommendation } : null,
        );
      } else if (data.nextQuestion) {
        setQualificationState((prev) =>
          prev
            ? { ...prev, question: data.nextQuestion!, turnsRemaining: data.turnsRemaining ?? 0 }
            : null,
        );
      }
    },
    onError: (err: Error) => Alert.alert("Error", err.message),
  });

  const fetchIntroDraft = useMutation({
    mutationFn: async ({ connectionId }: { connectionId: string }) => {
      const resp = await fetch(`${apiBase}/networking/connections/${connectionId}/draft-intro`, {
        method: "POST",
        headers,
        body: JSON.stringify({}),
      });
      if (!resp.ok) throw new Error("Failed to get draft");
      return resp.json() as Promise<{ draft: string }>;
    },
    onSuccess: (data, variables) => {
      setIntroDraft(data.draft);
      setIntroDraftConnectionId(variables.connectionId);
    },
    onError: (err: Error) => Alert.alert("Error", err.message),
  });

  const approveSendIntro = useMutation({
    mutationFn: async (connectionId: string) => {
      const resp = await fetch(`${apiBase}/networking/connections/${connectionId}/approve-send`, {
        method: "POST",
        headers,
        body: JSON.stringify({}),
      });
      if (!resp.ok) throw new Error("Failed to approve send");
      return resp.json() as Promise<{ success: boolean; message: string; sentTo: string }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["network-my-network"] });
      setIntroDraft(null);
      setIntroDraftConnectionId(null);
      Alert.alert("Sent!", `${data.message} Sent to: ${data.sentTo}`);
    },
    onError: (err: Error) => Alert.alert("Error", err.message),
  });

  const handleConnectPress = (match: NetworkMatch) => {
    Alert.alert(
      "Send Connection Request",
      `Connect with ${match.businessName} for a ${match.opportunityType} opportunity?\n\nRigo will run a qualification dialogue (up to 5 turns) before this reaches the other business. Estimated: ~5 AI events, ~2000 tokens.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Send Request",
          onPress: () => sendConnect.mutate({ targetBusinessId: match.matchedBusinessId, opportunityType: match.opportunityType, matchId: match.id }),
        },
      ],
    );
  };

  const handleDecisionPress = (connection: PendingConnection) => {
    setSelectedConnection(connection);
    setShowDecisionModal(true);
  };

  const handleAccept = () => {
    setShowDecisionModal(false);
    setShowHandoffModal(true);
    setHandoffDecisionId(selectedConnection?.connectionId ?? null);
  };

  const handleDecline = () => {
    if (!selectedConnection) return;
    Alert.alert("Decline Connection", "Are you sure you want to decline this connection?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Decline",
        style: "destructive",
        onPress: () => submitDecision.mutate({ connectionId: selectedConnection.connectionId, decision: "decline" }),
      },
    ]);
  };

  const handleHandoffConfirm = () => {
    if (!handoffDecisionId) return;
    submitDecision.mutate({ connectionId: handoffDecisionId, decision: "accept" });
  };

  const handleShareIntro = async (draft: string) => {
    try {
      await Share.share({ message: draft });
    } catch {
      Alert.alert("Error", "Could not open share sheet");
    }
  };

  if (statusLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centerContent}>
          <ActivityIndicator size="large" color={GOLD} />
        </View>
      </SafeAreaView>
    );
  }

  if (!status?.isPaid) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Network</Text>
        </View>
        <View style={styles.upgradeContainer}>
          <View style={styles.upgradeIconWrap}>
            <Feather name="globe" size={48} color={GOLD} />
          </View>
          <Text style={styles.upgradeTitle}>Premium Business Connections</Text>
          <Text style={styles.upgradeDesc}>
            Rigo acts as your personal matchmaker — surfacing pre-qualified business connections based on deep intent analysis. Quality over quantity.
          </Text>
          <View style={styles.upgradeFeatures}>
            {[
              "AI-qualified connections only",
              "Partnership, Client, Talent, Supplier & Collaboration types",
              "Plain-language match reasons",
              "Rigo handles outreach with AI disclosure",
            ].map((f) => (
              <View key={f} style={styles.upgradeFeatureRow}>
                <Feather name="check-circle" size={16} color={GOLD} />
                <Text style={styles.upgradeFeatureText}>{f}</Text>
              </View>
            ))}
          </View>
          <TouchableOpacity style={styles.upgradeBtn} activeOpacity={0.8}>
            <Feather name="zap" size={16} color="#0A0A0A" />
            <Text style={styles.upgradeBtnText}>Upgrade to Access Network</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (!status.isOptedIn) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Network</Text>
        </View>
        <ScrollView style={styles.scroll} contentContainerStyle={styles.consentContainer}>
          <View style={styles.consentIconWrap}>
            <Feather name="shield" size={40} color={GOLD} />
          </View>
          <Text style={styles.consentTitle}>GDPR Consent Required</Text>
          <Text style={styles.consentBody}>
            Before activating the Network, you must consent to your business profile and connection requests being processed by Rigo AI for matching and qualification purposes.
          </Text>
          <View style={styles.consentPoints}>
            {[
              "Your business profile is used for AI matching",
              "Connection requests are processed by Rigo agent",
              "All AI activity is disclosed to counterparties",
              "You make all final decisions — Rigo never acts autonomously",
              "You can opt out at any time",
            ].map((p) => (
              <View key={p} style={styles.consentPoint}>
                <Feather name="check" size={14} color={GOLD} style={styles.consentPointIcon} />
                <Text style={styles.consentPointText}>{p}</Text>
              </View>
            ))}
          </View>

          <Text style={styles.fieldLabel}>Opportunity Types</Text>
          <View style={styles.chipRow}>
            {OPPORTUNITY_TYPES.map((type) => (
              <TouchableOpacity
                key={type}
                style={[styles.chip, selectedOpportunityTypes.includes(type) && styles.chipActive]}
                onPress={() =>
                  setSelectedOpportunityTypes((prev) =>
                    prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type],
                  )
                }
              >
                <Text style={[styles.chipText, selectedOpportunityTypes.includes(type) && styles.chipTextActive]}>
                  {type}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.fieldLabel}>Sector Preferences (comma-separated)</Text>
          <TextInput
            style={styles.textInput}
            value={sectorPrefs}
            onChangeText={setSectorPrefs}
            placeholder="e.g. Tech, Finance, Healthcare"
            placeholderTextColor="#555"
          />

          <Text style={styles.fieldLabel}>Must-Haves</Text>
          <TextInput
            style={[styles.textInput, styles.textInputTall]}
            value={mustHaves}
            onChangeText={setMustHaves}
            placeholder="e.g. UK-based, minimum 2 years trading, revenue > £100k"
            placeholderTextColor="#555"
            multiline
          />

          <Text style={styles.fieldLabel}>Deal-Breakers</Text>
          <TextInput
            style={[styles.textInput, styles.textInputTall]}
            value={dealBreakers}
            onChangeText={setDealBreakers}
            placeholder="e.g. No startups, no cold approaches"
            placeholderTextColor="#555"
            multiline
          />

          <Text style={styles.consentLegal}>
            By continuing you confirm you have read and accept the GDPR data processing terms. Consent timestamp will be recorded.
          </Text>

          <TouchableOpacity
            style={[styles.consentBtn, selectedOpportunityTypes.length === 0 && styles.consentBtnDisabled]}
            onPress={() => optIn.mutate()}
            disabled={selectedOpportunityTypes.length === 0 || optIn.isPending}
            activeOpacity={0.8}
          >
            {optIn.isPending ? (
              <ActivityIndicator size="small" color="#0A0A0A" />
            ) : (
              <Text style={styles.consentBtnText}>I Consent — Activate Network</Text>
            )}
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Network</Text>
        <View style={styles.disclosureBadge}>
          <Feather name="cpu" size={10} color={GOLD} />
          <Text style={styles.disclosureText}>AI-powered</Text>
        </View>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabsScroll} contentContainerStyle={styles.tabs}>
        {(["matches", "incoming", "pending", "my-network"] as NetworkTab[]).map((tab) => {
          let label: string;
          if (tab === "matches") label = "Matches";
          else if (tab === "incoming") label = incoming.length > 0 ? `Incoming (${incoming.length})` : "Incoming";
          else if (tab === "pending") {
            const rigoDrafts = myNetwork.filter((c) => c.handoffMode === "rigo" && c.status === "accepted");
            const total = pending.length + rigoDrafts.length;
            label = total > 0 ? `Decisions (${total})` : "Decisions";
          }
          else label = "My Network";
          return (
            <TouchableOpacity
              key={tab}
              style={[styles.tab, activeTab === tab && styles.tabActive]}
              onPress={() => setActiveTab(tab)}
            >
              <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>{label}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
        {activeTab === "matches" && (
          <View style={styles.section}>
            {matchesLoading ? (
              <View style={styles.centerContent}>
                <ActivityIndicator size="large" color={GOLD} />
                <Text style={styles.loadingText}>Rigo is finding matches...</Text>
              </View>
            ) : matches.length === 0 ? (
              <View style={styles.emptyState}>
                <Feather name="users" size={40} color="#2A2A2A" />
                <Text style={styles.emptyTitle}>No matches yet</Text>
                <Text style={styles.emptySubtitle}>Rigo is analysing business profiles. Check back soon.</Text>
                <TouchableOpacity style={styles.refreshBtn} onPress={() => refetchMatches()} activeOpacity={0.7}>
                  <Feather name="refresh-cw" size={14} color={GOLD} />
                  <Text style={styles.refreshBtnText}>Refresh Matches</Text>
                </TouchableOpacity>
              </View>
            ) : (
              matches.map((match) => (
                <View key={match.id} style={styles.matchCard}>
                  <View style={styles.matchHeader}>
                    <View style={styles.matchIconWrap}>
                      <Feather name="briefcase" size={20} color={GOLD} />
                    </View>
                    <View style={styles.matchInfo}>
                      <Text style={styles.matchName}>{match.businessName}</Text>
                      <Text style={styles.matchSector}>{match.sector}</Text>
                    </View>
                    <View style={styles.opportunityBadge}>
                      <Text style={styles.opportunityBadgeText}>{match.opportunityType}</Text>
                    </View>
                  </View>
                  <View style={styles.matchReasonWrap}>
                    <Feather name="cpu" size={12} color={GOLD} style={styles.matchReasonIcon} />
                    <Text style={styles.matchReason}>{match.matchReason}</Text>
                  </View>
                  <View style={styles.matchFooter}>
                    <View style={styles.strengthWrap}>
                      <Text style={styles.strengthLabel}>Match Strength</Text>
                      <MatchStrengthBar score={match.matchStrength} />
                      <Text style={styles.strengthValue}>{match.matchStrength}%</Text>
                    </View>
                    <TouchableOpacity
                      style={styles.connectBtn}
                      onPress={() => handleConnectPress(match)}
                      disabled={sendConnect.isPending}
                      activeOpacity={0.8}
                    >
                      <Feather name="user-plus" size={14} color="#0A0A0A" />
                      <Text style={styles.connectBtnText}>Connect</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))
            )}
          </View>
        )}

        {activeTab === "incoming" && (
          <View style={styles.section}>
            <View style={styles.incomingBanner}>
              <Feather name="cpu" size={12} color={GOLD} />
              <Text style={styles.incomingBannerText}>These are businesses that want to connect with you. Rigo is running a qualification dialogue on their behalf. Please answer each question honestly.</Text>
            </View>
            {incomingLoading ? (
              <View style={styles.centerContent}>
                <ActivityIndicator size="large" color={GOLD} />
              </View>
            ) : incoming.length === 0 ? (
              <View style={styles.emptyState}>
                <Feather name="inbox" size={40} color="#2A2A2A" />
                <Text style={styles.emptyTitle}>No incoming requests</Text>
                <Text style={styles.emptySubtitle}>When another business wants to connect with you, their qualification questions will appear here.</Text>
                <TouchableOpacity style={styles.refreshBtn} onPress={() => refetchIncoming()} activeOpacity={0.7}>
                  <Feather name="refresh-cw" size={14} color={GOLD} />
                  <Text style={styles.refreshBtnText}>Refresh</Text>
                </TouchableOpacity>
              </View>
            ) : (
              incoming.map((req) => (
                <View key={req.connectionId} style={styles.pendingCard}>
                  <View style={styles.pendingHeader}>
                    <Text style={styles.pendingName}>{req.requesterBusinessName}</Text>
                    <View style={[styles.statusBadge, styles.statusPending]}>
                      <Text style={styles.statusBadgeText}>{req.opportunityType}</Text>
                    </View>
                  </View>
                  <Text style={styles.pendingSector}>{req.requesterSector}</Text>
                  <View style={styles.turnProgressWrap}>
                    <Text style={styles.turnProgressText}>Turn {req.completedTurns + 1} of {req.totalTurns}</Text>
                    <View style={styles.turnProgressBar}>
                      <View style={[styles.turnProgressFill, { width: `${((req.completedTurns) / req.totalTurns) * 100}%` as `${number}%` }]} />
                    </View>
                  </View>
                  {req.currentQuestion ? (
                    <View style={styles.questionWrap}>
                      <View style={styles.questionHeader}>
                        <Feather name="cpu" size={12} color={GOLD} />
                        <Text style={styles.questionLabel}>Rigo asks:</Text>
                      </View>
                      <Text style={styles.questionText}>{req.currentQuestion}</Text>
                      <TouchableOpacity
                        style={styles.answerBtn}
                        onPress={() => {
                          setSelectedIncoming(req);
                          setShowQualificationModal(true);
                          setQualificationResponse("");
                        }}
                        activeOpacity={0.8}
                      >
                        <Feather name="message-square" size={14} color="#0A0A0A" />
                        <Text style={styles.answerBtnText}>Answer Question</Text>
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <View style={styles.summaryWrap}>
                      <Text style={styles.summaryLabel}>All questions answered — awaiting decision from {req.requesterBusinessName}.</Text>
                    </View>
                  )}
                </View>
              ))
            )}
          </View>
        )}

        {activeTab === "pending" && (
          <View style={styles.section}>
            {(() => {
              const rigoDrafts = myNetwork.filter((c) => c.handoffMode === "rigo" && c.status === "accepted");
              return (
                <>
                  {rigoDrafts.length > 0 && (
                    <View style={{ marginBottom: 16 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 10 }}>
                        <Feather name="cpu" size={14} color={GOLD} />
                        <Text style={{ color: GOLD, fontWeight: "700", fontSize: 13, letterSpacing: 0.5, textTransform: "uppercase" }}>
                          Rigo Pending Approvals
                        </Text>
                      </View>
                      {rigoDrafts.map((conn) => (
                        <View key={conn.connectionId} style={[styles.pendingCard, { borderLeftWidth: 2, borderLeftColor: GOLD }]}>
                          <View style={styles.pendingHeader}>
                            <Text style={styles.pendingName}>{conn.otherBusinessName}</Text>
                            <View style={[styles.statusBadge, { backgroundColor: "rgba(212,175,55,0.15)" }]}>
                              <Text style={[styles.statusBadgeText, { color: GOLD }]}>Draft Ready</Text>
                            </View>
                          </View>
                          <Text style={styles.pendingSector}>{conn.otherSector} · {conn.opportunityType}</Text>
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8 }}>
                            <Feather name="info" size={12} color="#8A8A8A" />
                            <Text style={{ color: "#8A8A8A", fontSize: 12 }}>
                              Rigo drafted an intro. Review and approve before sending.
                            </Text>
                          </View>
                          <TouchableOpacity
                            style={[styles.shareBtn, { marginTop: 10, backgroundColor: "rgba(212,175,55,0.1)" }]}
                            onPress={() => {
                              setIntroDraftConnectionId(conn.connectionId);
                              fetchIntroDraft.mutate({ connectionId: conn.connectionId });
                            }}
                            disabled={fetchIntroDraft.isPending}
                            activeOpacity={0.7}
                          >
                            <Feather name="cpu" size={14} color={GOLD} />
                            <Text style={styles.shareBtnText}>Review & Approve Draft</Text>
                          </TouchableOpacity>
                        </View>
                      ))}
                    </View>
                  )}

                  {pendingLoading ? (
                    <View style={styles.centerContent}>
                      <ActivityIndicator size="large" color={GOLD} />
                    </View>
                  ) : pending.length === 0 && rigoDrafts.length === 0 ? (
                    <View style={styles.emptyState}>
                      <Feather name="clock" size={40} color="#2A2A2A" />
                      <Text style={styles.emptyTitle}>No pending decisions</Text>
                      <Text style={styles.emptySubtitle}>When you request a connection, Rigo qualifies them first — then they appear here for your decision.</Text>
                    </View>
                  ) : pending.length > 0 ? (
                    <>
                      {rigoDrafts.length > 0 && (
                        <Text style={{ color: "#8A8A8A", fontWeight: "600", fontSize: 12, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 }}>
                          Connection Decisions
                        </Text>
                      )}
                      {pending.map((conn) => (
                        <View key={conn.connectionId} style={styles.pendingCard}>
                          <View style={styles.pendingHeader}>
                            <Text style={styles.pendingName}>{conn.receiverBusinessName}</Text>
                            <View style={[styles.statusBadge, styles.statusPending]}>
                              <Text style={styles.statusBadgeText}>Awaiting Decision</Text>
                            </View>
                          </View>
                          <Text style={styles.pendingSector}>{conn.receiverSector} · {conn.opportunityType}</Text>
                          {conn.qualificationSummary && (
                            <View style={styles.summaryWrap}>
                              <Text style={styles.summaryLabel}>Rigo Summary</Text>
                              <Text style={styles.summaryText}>{conn.qualificationSummary}</Text>
                            </View>
                          )}
                          {conn.agentRecommendation && (
                            <View style={styles.recommendationWrap}>
                              <Feather name="cpu" size={12} color={GOLD} />
                              <Text style={styles.recommendationText}>{conn.agentRecommendation}</Text>
                            </View>
                          )}
                          <MatchStrengthBar score={conn.matchStrength} />
                          <View style={styles.pendingActions}>
                            <TouchableOpacity
                              style={styles.viewTranscriptBtn}
                              onPress={() => handleDecisionPress(conn)}
                              activeOpacity={0.7}
                            >
                              <Feather name="file-text" size={14} color={GOLD} />
                              <Text style={styles.viewTranscriptText}>Review & Decide</Text>
                            </TouchableOpacity>
                          </View>
                        </View>
                      ))}
                    </>
                  ) : null}
                </>
              );
            })()}
          </View>
        )}

        {activeTab === "my-network" && (
          <View style={styles.section}>
            {networkLoading ? (
              <View style={styles.centerContent}>
                <ActivityIndicator size="large" color={GOLD} />
              </View>
            ) : myNetwork.length === 0 ? (
              <View style={styles.emptyState}>
                <Feather name="globe" size={40} color="#2A2A2A" />
                <Text style={styles.emptyTitle}>No connections yet</Text>
                <Text style={styles.emptySubtitle}>Your accepted connections will appear here with status, handoff mode, and follow-up prompts.</Text>
              </View>
            ) : (
              myNetwork.map((conn) => (
                <View key={conn.connectionId} style={styles.networkCard}>
                  <View style={styles.networkCardHeader}>
                    <View style={styles.networkAvatarWrap}>
                      <Text style={styles.networkAvatarText}>{conn.otherBusinessName.charAt(0).toUpperCase()}</Text>
                    </View>
                    <View style={styles.networkInfo}>
                      <Text style={styles.networkName}>{conn.otherBusinessName}</Text>
                      <Text style={styles.networkMeta}>{conn.otherSector} · {conn.opportunityType}</Text>
                    </View>
                    <View style={[styles.handoffBadge, conn.handoffMode === "rigo" ? styles.handoffRigo : styles.handoffDirect]}>
                      <Feather name={conn.handoffMode === "rigo" ? "cpu" : "user"} size={10} color={conn.handoffMode === "rigo" ? GOLD : "#8A8A8A"} />
                      <Text style={[styles.handoffBadgeText, conn.handoffMode === "rigo" ? styles.handoffRigoText : styles.handoffDirectText]}>
                        {conn.handoffMode === "rigo" ? "Rigo" : "Direct"}
                      </Text>
                    </View>
                  </View>
                  {conn.followups.filter((f) => !f.completedAt).length > 0 && (
                    <View style={styles.followupWrap}>
                      <Feather name="bell" size={12} color="#F59E0B" />
                      <Text style={styles.followupText}>{conn.followups.find((f) => !f.completedAt)?.promptText}</Text>
                    </View>
                  )}
                  {conn.handoffMode === "direct" && (
                    <TouchableOpacity
                      style={styles.shareBtn}
                      onPress={async () => {
                        try {
                          const result = await fetchIntroDraft.mutateAsync({ connectionId: conn.connectionId });
                          if (result?.draft) {
                            await handleShareIntro(result.draft);
                          }
                        } catch {
                          Alert.alert("Error", "Could not load draft intro");
                        }
                      }}
                      disabled={fetchIntroDraft.isPending}
                      activeOpacity={0.7}
                    >
                      <Feather name="share" size={14} color={GOLD} />
                      <Text style={styles.shareBtnText}>Share Intro</Text>
                    </TouchableOpacity>
                  )}
                  {conn.handoffMode === "rigo" && (
                    <TouchableOpacity
                      style={[styles.shareBtn, { backgroundColor: "rgba(212,175,55,0.1)" }]}
                      onPress={() => {
                        fetchIntroDraft.mutate({ connectionId: conn.connectionId });
                      }}
                      disabled={fetchIntroDraft.isPending}
                      activeOpacity={0.7}
                    >
                      <Feather name="cpu" size={14} color={GOLD} />
                      <Text style={styles.shareBtnText}>Review & Approve Draft</Text>
                    </TouchableOpacity>
                  )}
                  <Text style={styles.connectedAt}>Connected {new Date(conn.connectedAt).toLocaleDateString("en-GB")}</Text>
                </View>
              ))
            )}
          </View>
        )}
      </ScrollView>

      <Modal visible={showDecisionModal} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={styles.modal}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Review Connection</Text>
            <TouchableOpacity onPress={() => setShowDecisionModal(false)}>
              <Feather name="x" size={22} color="#FFFFFF" />
            </TouchableOpacity>
          </View>
          {selectedConnection && (
            <ScrollView style={styles.modalContent}>
              <View style={styles.decisionBusinessCard}>
                <Text style={styles.decisionBusinessName}>{selectedConnection.receiverBusinessName}</Text>
                <Text style={styles.decisionBusinessMeta}>{selectedConnection.receiverSector} · {selectedConnection.opportunityType}</Text>
                <MatchStrengthBar score={selectedConnection.matchStrength} />
                <Text style={styles.decisionMatchStrength}>Match Strength: {selectedConnection.matchStrength}%</Text>
              </View>

              {selectedConnection.qualificationSummary && (
                <View style={styles.decisionSection}>
                  <Text style={styles.decisionSectionTitle}>Qualification Summary</Text>
                  <Text style={styles.decisionSectionText}>{selectedConnection.qualificationSummary}</Text>
                </View>
              )}

              {selectedConnection.agentRecommendation && (
                <View style={styles.decisionRecommendation}>
                  <Feather name="cpu" size={14} color={GOLD} />
                  <Text style={styles.decisionRecommendationText}>{selectedConnection.agentRecommendation}</Text>
                </View>
              )}

              <View style={styles.decisionSection}>
                <Text style={styles.decisionSectionTitle}>Qualification Transcript</Text>
                {selectedConnection.qualificationTranscript.map((t) => (
                  <View key={t.turn} style={styles.transcriptTurn}>
                    <Text style={styles.transcriptQ}>Q{t.turn}: {t.question}</Text>
                    <Text style={styles.transcriptA}>A: {t.response ?? "(no response)"}</Text>
                  </View>
                ))}
              </View>

              <View style={styles.aiDisclosure}>
                <Feather name="info" size={12} color="#8A8A8A" />
                <Text style={styles.aiDisclosureText}>This qualification was conducted by Rigo AI. You make the final decision.</Text>
              </View>
            </ScrollView>
          )}
          <View style={styles.modalFooter}>
            <TouchableOpacity
              style={[styles.decisionBtn, styles.declineBtn]}
              onPress={handleDecline}
              disabled={submitDecision.isPending}
              activeOpacity={0.8}
            >
              <Feather name="x-circle" size={16} color="#EF4444" />
              <Text style={styles.declineBtnText}>Decline</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.decisionBtn, styles.acceptBtn]}
              onPress={handleAccept}
              activeOpacity={0.8}
            >
              <Feather name="check-circle" size={16} color="#0A0A0A" />
              <Text style={styles.acceptBtnText}>Accept</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </Modal>

      <Modal visible={showHandoffModal} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={styles.modal}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Choose Handoff Mode</Text>
            <TouchableOpacity onPress={() => setShowHandoffModal(false)}>
              <Feather name="x" size={22} color="#FFFFFF" />
            </TouchableOpacity>
          </View>
          <ScrollView style={styles.modalContent}>
            <Text style={styles.handoffDesc}>How would you like to manage this new connection?</Text>

            <TouchableOpacity
              style={[styles.handoffOption, selectedHandoff === "rigo" && styles.handoffOptionActive]}
              onPress={() => setSelectedHandoff("rigo")}
              activeOpacity={0.7}
            >
              <View style={styles.handoffOptionIcon}>
                <Feather name="cpu" size={24} color={GOLD} />
              </View>
              <View style={styles.handoffOptionInfo}>
                <Text style={styles.handoffOptionTitle}>Let Rigo Handle It</Text>
                <Text style={styles.handoffOptionDesc}>Rigo drafts and sends an intro email with AI disclosure, follows up after 3 days, and routes significant decisions to you.</Text>
              </View>
              {selectedHandoff === "rigo" && <Feather name="check-circle" size={20} color={GOLD} />}
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.handoffOption, selectedHandoff === "direct" && styles.handoffOptionActive]}
              onPress={() => setSelectedHandoff("direct")}
              activeOpacity={0.7}
            >
              <View style={styles.handoffOptionIcon}>
                <Feather name="user" size={24} color="#8A8A8A" />
              </View>
              <View style={styles.handoffOptionInfo}>
                <Text style={styles.handoffOptionTitle}>I'll Go Direct</Text>
                <Text style={styles.handoffOptionDesc}>Rigo drafts an intro message for you. You send it directly via WhatsApp, iMessage, email, LinkedIn, or any app.</Text>
              </View>
              {selectedHandoff === "direct" && <Feather name="check-circle" size={20} color={GOLD} />}
            </TouchableOpacity>

            <View style={styles.aiDisclosure}>
              <Feather name="info" size={12} color="#8A8A8A" />
              <Text style={styles.aiDisclosureText}>All AI-generated messages include a mandatory disclosure: "This message was drafted by Rigo AI on behalf of [Business Name]."</Text>
            </View>
          </ScrollView>
          <View style={styles.modalFooter}>
            <TouchableOpacity
              style={styles.confirmHandoffBtn}
              onPress={handleHandoffConfirm}
              disabled={submitDecision.isPending}
              activeOpacity={0.8}
            >
              {submitDecision.isPending ? (
                <ActivityIndicator size="small" color="#0A0A0A" />
              ) : (
                <Text style={styles.confirmHandoffBtnText}>Confirm & Accept</Text>
              )}
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </Modal>

      {introDraft && (
        <Modal visible={!!introDraft} animationType="slide" presentationStyle="pageSheet">
          <SafeAreaView style={styles.modal}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Rigo's Intro Draft</Text>
              <TouchableOpacity onPress={() => setIntroDraft(null)}>
                <Feather name="x" size={22} color="#FFFFFF" />
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.modalContent}>
              <View style={styles.draftWrap}>
                <Text style={styles.draftText}>{introDraft}</Text>
              </View>
              <View style={styles.aiDisclosure}>
                <Feather name="info" size={12} color="#8A8A8A" />
                <Text style={styles.aiDisclosureText}>This message was drafted by Rigo AI. It includes the mandatory AI disclosure footer.</Text>
              </View>
            </ScrollView>
            <View style={styles.modalFooter}>
              {introDraftConnectionId && (
                <TouchableOpacity
                  style={[styles.confirmHandoffBtn, { marginBottom: 8, backgroundColor: "#D4AF37" }]}
                  onPress={() => {
                    if (introDraftConnectionId) {
                      approveSendIntro.mutate(introDraftConnectionId);
                    }
                  }}
                  disabled={approveSendIntro.isPending}
                  activeOpacity={0.8}
                >
                  <Feather name="check-circle" size={16} color="#0A0A0A" />
                  <Text style={styles.confirmHandoffBtnText}>Approve & Send via Rigo</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={[styles.confirmHandoffBtn, { backgroundColor: "#1A1A1A" }]}
                onPress={async () => {
                  if (introDraft) await handleShareIntro(introDraft);
                  setIntroDraft(null);
                  setIntroDraftConnectionId(null);
                }}
                activeOpacity={0.8}
              >
                <Feather name="share" size={16} color={GOLD} />
                <Text style={[styles.confirmHandoffBtnText, { color: GOLD }]}>Share via...</Text>
              </TouchableOpacity>
            </View>
          </SafeAreaView>
        </Modal>
      )}

      <Modal visible={showQualificationModal && !!selectedIncoming} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={styles.modal}>
          <View style={styles.modalHeader}>
            <View>
              <Text style={styles.modalTitle}>Qualification Question</Text>
              <Text style={styles.modalSubtitle}>{selectedIncoming?.requesterBusinessName} · {selectedIncoming?.opportunityType}</Text>
            </View>
            <TouchableOpacity onPress={() => { setShowQualificationModal(false); setSelectedIncoming(null); }}>
              <Feather name="x" size={22} color="#FFFFFF" />
            </TouchableOpacity>
          </View>
          <ScrollView style={styles.modalContent}>
            <View style={styles.aiDisclosure}>
              <Feather name="cpu" size={12} color={GOLD} />
              <Text style={[styles.aiDisclosureText, { color: GOLD }]}>Rigo AI is running this qualification on behalf of {selectedIncoming?.requesterBusinessName}. Your responses are used to help them decide whether to connect with you.</Text>
            </View>
            {selectedIncoming?.currentQuestion && (
              <View style={styles.questionWrapModal}>
                <Text style={styles.questionLabelModal}>Question {(selectedIncoming.completedTurns) + 1} of {selectedIncoming.totalTurns}:</Text>
                <Text style={styles.questionTextModal}>{selectedIncoming.currentQuestion}</Text>
              </View>
            )}
            <TextInput
              style={[styles.textInput, styles.textInputTall]}
              value={qualificationResponse}
              onChangeText={setQualificationResponse}
              placeholder="Type your honest answer here..."
              placeholderTextColor="#555"
              multiline
              autoFocus
            />
            <Text style={styles.consentLegal}>
              Turn {(selectedIncoming?.completedTurns ?? 0) + 1} of {selectedIncoming?.totalTurns ?? 5}. Rigo AI uses your responses to summarise and recommend to the requester.
            </Text>
          </ScrollView>
          <View style={styles.modalFooter}>
            <TouchableOpacity
              style={[styles.confirmHandoffBtn, (!qualificationResponse.trim() || submitQualification.isPending) && styles.consentBtnDisabled]}
              onPress={() => {
                if (!selectedIncoming || !qualificationResponse.trim()) return;
                submitQualification.mutate(
                  { connectionId: selectedIncoming.connectionId, response: qualificationResponse },
                  {
                    onSuccess: (data) => {
                      setShowQualificationModal(false);
                      setSelectedIncoming(null);
                      setQualificationResponse("");
                      queryClient.invalidateQueries({ queryKey: ["network-incoming"] });
                      if (data.complete) {
                        Alert.alert(
                          "Qualification Complete",
                          "All questions answered. The requester will review your responses and make a decision.",
                          [{ text: "OK" }],
                        );
                      } else {
                        Alert.alert("Response Submitted", "Your answer was recorded. Check back for the next question.", [{ text: "OK" }]);
                      }
                    },
                    onError: (err: Error) => Alert.alert("Error", err.message),
                  },
                );
              }}
              disabled={!qualificationResponse.trim() || submitQualification.isPending}
              activeOpacity={0.8}
            >
              {submitQualification.isPending ? (
                <ActivityIndicator size="small" color="#0A0A0A" />
              ) : (
                <>
                  <Feather name="send" size={16} color="#0A0A0A" />
                  <Text style={styles.confirmHandoffBtnText}>Submit Answer</Text>
                </>
              )}
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
  headerTitle: { fontSize: 24, fontFamily: "Inter_700Bold", color: "#FFFFFF", letterSpacing: -0.5 },
  disclosureBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: Colors.goldMuted,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  disclosureText: { fontSize: 11, fontFamily: "Inter_500Medium", color: GOLD },
  tabs: { flexDirection: "row", paddingHorizontal: 20, gap: 8, marginBottom: 16 },
  tab: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: "#1A1A1A",
    borderColor: "#2A2A2A",
    borderWidth: 1,
  },
  tabActive: { backgroundColor: GOLD },
  tabText: { fontSize: 13, fontFamily: "Inter_500Medium", color: "#8A8A8A" },
  tabTextActive: { color: "#0A0A0A" },
  scroll: { flex: 1 },
  section: { paddingHorizontal: 20, paddingBottom: 100 },
  centerContent: { flex: 1, justifyContent: "center", alignItems: "center", paddingVertical: 60 },
  loadingText: { fontSize: 14, fontFamily: "Inter_400Regular", color: "#8A8A8A", marginTop: 12 },
  emptyState: { alignItems: "center", paddingTop: 60, paddingHorizontal: 40, gap: 10 },
  emptyTitle: { fontSize: 17, fontFamily: "Inter_600SemiBold", color: "#555" },
  emptySubtitle: { fontSize: 14, fontFamily: "Inter_400Regular", color: "#444", textAlign: "center" },
  refreshBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: Colors.goldMuted,
    borderRadius: 20,
  },
  refreshBtnText: { fontSize: 13, fontFamily: "Inter_500Medium", color: GOLD },
  upgradeContainer: { flex: 1, paddingHorizontal: 24, paddingTop: 20, alignItems: "center" },
  upgradeIconWrap: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: Colors.goldMuted,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 20,
  },
  upgradeTitle: { fontSize: 22, fontFamily: "Inter_700Bold", color: "#FFFFFF", textAlign: "center", marginBottom: 12 },
  upgradeDesc: { fontSize: 14, fontFamily: "Inter_400Regular", color: "#8A8A8A", textAlign: "center", lineHeight: 22, marginBottom: 24 },
  upgradeFeatures: { alignSelf: "stretch", marginBottom: 32, gap: 10 },
  upgradeFeatureRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  upgradeFeatureText: { fontSize: 14, fontFamily: "Inter_400Regular", color: "#FFFFFF", flex: 1 },
  upgradeBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: GOLD,
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 12,
  },
  upgradeBtnText: { fontSize: 16, fontFamily: "Inter_700Bold", color: "#0A0A0A" },
  consentContainer: { paddingHorizontal: 20, paddingBottom: 60 },
  consentIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: Colors.goldMuted,
    justifyContent: "center",
    alignItems: "center",
    alignSelf: "center",
    marginBottom: 20,
  },
  consentTitle: { fontSize: 22, fontFamily: "Inter_700Bold", color: "#FFFFFF", textAlign: "center", marginBottom: 12 },
  consentBody: { fontSize: 14, fontFamily: "Inter_400Regular", color: "#8A8A8A", textAlign: "center", lineHeight: 22, marginBottom: 20 },
  consentPoints: { gap: 10, marginBottom: 24 },
  consentPoint: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  consentPointIcon: { marginTop: 2 },
  consentPointText: { fontSize: 14, fontFamily: "Inter_400Regular", color: "#FFFFFF", flex: 1 },
  fieldLabel: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    color: "#8A8A8A",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 8,
    marginTop: 16,
  },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 4 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: "#1A1A1A",
    borderColor: "#2A2A2A",
    borderWidth: 1,
  },
  chipActive: { backgroundColor: Colors.goldMuted, borderColor: GOLD + "66" },
  chipText: { fontSize: 13, fontFamily: "Inter_500Medium", color: "#8A8A8A" },
  chipTextActive: { color: GOLD },
  textInput: {
    backgroundColor: "#1A1A1A",
    borderColor: "#2A2A2A",
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: "#FFFFFF",
  },
  textInputTall: { height: 80, textAlignVertical: "top" },
  consentLegal: { fontSize: 12, fontFamily: "Inter_400Regular", color: "#555", textAlign: "center", marginTop: 20, lineHeight: 18 },
  consentBtn: {
    backgroundColor: GOLD,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 20,
  },
  consentBtnDisabled: { opacity: 0.5 },
  consentBtnText: { fontSize: 16, fontFamily: "Inter_700Bold", color: "#0A0A0A" },
  matchCard: {
    backgroundColor: "#1A1A1A",
    borderColor: "#2A2A2A",
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
  },
  matchHeader: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 12 },
  matchIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.goldMuted,
    justifyContent: "center",
    alignItems: "center",
  },
  matchInfo: { flex: 1 },
  matchName: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: "#FFFFFF" },
  matchSector: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#8A8A8A", marginTop: 2 },
  opportunityBadge: { backgroundColor: "#1E3A1E", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  opportunityBadgeText: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: "#22C55E" },
  matchReasonWrap: { flexDirection: "row", alignItems: "flex-start", gap: 8, backgroundColor: "#0F0F0F", borderRadius: 8, padding: 10, marginBottom: 12 },
  matchReasonIcon: { marginTop: 2 },
  matchReason: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#CCCCCC", flex: 1, lineHeight: 20 },
  matchFooter: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between" },
  strengthWrap: { flex: 1, marginRight: 12 },
  strengthLabel: { fontSize: 11, fontFamily: "Inter_500Medium", color: "#555", marginBottom: 4 },
  strengthValue: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: GOLD, marginTop: 4 },
  connectBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: GOLD,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 10,
  },
  connectBtnText: { fontSize: 13, fontFamily: "Inter_700Bold", color: "#0A0A0A" },
  pendingCard: {
    backgroundColor: "#1A1A1A",
    borderColor: "#2A2A2A",
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
  },
  pendingHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 },
  pendingName: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: "#FFFFFF", flex: 1 },
  statusBadge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  statusPending: { backgroundColor: "#1F1A00" },
  statusBadgeText: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: "#F59E0B" },
  pendingSector: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#8A8A8A", marginBottom: 10 },
  summaryWrap: { backgroundColor: "#0F0F0F", borderRadius: 8, padding: 10, marginBottom: 8 },
  summaryLabel: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: "#555", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 },
  summaryText: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#CCCCCC", lineHeight: 20 },
  recommendationWrap: { flexDirection: "row", alignItems: "flex-start", gap: 8, marginBottom: 10 },
  recommendationText: { fontSize: 13, fontFamily: "Inter_500Medium", color: GOLD, flex: 1 },
  pendingActions: { marginTop: 12 },
  viewTranscriptBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderColor: GOLD + "44",
    borderWidth: 1,
    borderRadius: 10,
    alignSelf: "flex-start",
  },
  viewTranscriptText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: GOLD },
  networkCard: {
    backgroundColor: "#1A1A1A",
    borderColor: "#2A2A2A",
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
  },
  networkCardHeader: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 10 },
  networkAvatarWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.goldMuted,
    justifyContent: "center",
    alignItems: "center",
  },
  networkAvatarText: { fontSize: 18, fontFamily: "Inter_700Bold", color: GOLD },
  networkInfo: { flex: 1 },
  networkName: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#FFFFFF" },
  networkMeta: { fontSize: 12, fontFamily: "Inter_400Regular", color: "#8A8A8A", marginTop: 2 },
  handoffBadge: { flexDirection: "row", alignItems: "center", gap: 4, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  handoffRigo: { backgroundColor: Colors.goldMuted },
  handoffDirect: { backgroundColor: "#1F1F1F" },
  handoffBadgeText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  handoffRigoText: { color: GOLD },
  handoffDirectText: { color: "#8A8A8A" },
  followupWrap: { flexDirection: "row", alignItems: "flex-start", gap: 8, backgroundColor: "#1F1A00", borderRadius: 8, padding: 10, marginBottom: 10 },
  followupText: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#F59E0B", flex: 1 },
  shareBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderColor: GOLD + "44",
    borderWidth: 1,
    borderRadius: 10,
    alignSelf: "flex-start",
    marginBottom: 8,
  },
  shareBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: GOLD },
  connectedAt: { fontSize: 11, fontFamily: "Inter_400Regular", color: "#555", marginTop: 6 },
  modal: { flex: 1, backgroundColor: "#0A0A0A" },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomColor: "#2A2A2A",
    borderBottomWidth: 1,
  },
  modalTitle: { fontSize: 18, fontFamily: "Inter_700Bold", color: "#FFFFFF" },
  modalContent: { flex: 1, padding: 20 },
  modalFooter: { padding: 20, borderTopColor: "#2A2A2A", borderTopWidth: 1, flexDirection: "row", gap: 12 },
  decisionBusinessCard: {
    backgroundColor: "#1A1A1A",
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
  },
  decisionBusinessName: { fontSize: 20, fontFamily: "Inter_700Bold", color: "#FFFFFF", marginBottom: 4 },
  decisionBusinessMeta: { fontSize: 14, fontFamily: "Inter_400Regular", color: "#8A8A8A", marginBottom: 8 },
  decisionMatchStrength: { fontSize: 13, fontFamily: "Inter_500Medium", color: GOLD, marginTop: 4 },
  decisionSection: { marginBottom: 20 },
  decisionSectionTitle: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#8A8A8A", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 },
  decisionSectionText: { fontSize: 14, fontFamily: "Inter_400Regular", color: "#CCCCCC", lineHeight: 22 },
  decisionRecommendation: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    backgroundColor: Colors.goldMuted,
    borderRadius: 10,
    padding: 12,
    marginBottom: 20,
  },
  decisionRecommendationText: { fontSize: 14, fontFamily: "Inter_500Medium", color: GOLD, flex: 1 },
  transcriptTurn: { marginBottom: 12, borderLeftColor: "#2A2A2A", borderLeftWidth: 2, paddingLeft: 12 },
  transcriptQ: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#CCCCCC", marginBottom: 4 },
  transcriptA: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#8A8A8A" },
  aiDisclosure: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    backgroundColor: "#1A1A1A",
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
  },
  aiDisclosureText: { fontSize: 12, fontFamily: "Inter_400Regular", color: "#555", flex: 1 },
  decisionBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 14,
    borderRadius: 12,
  },
  declineBtn: { backgroundColor: "#1A1A1A", borderColor: "#EF444444", borderWidth: 1 },
  acceptBtn: { backgroundColor: GOLD },
  declineBtnText: { fontSize: 15, fontFamily: "Inter_700Bold", color: "#EF4444" },
  acceptBtnText: { fontSize: 15, fontFamily: "Inter_700Bold", color: "#0A0A0A" },
  handoffDesc: { fontSize: 14, fontFamily: "Inter_400Regular", color: "#8A8A8A", marginBottom: 20, lineHeight: 22 },
  handoffOption: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 14,
    backgroundColor: "#1A1A1A",
    borderColor: "#2A2A2A",
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
  },
  handoffOptionActive: { borderColor: GOLD + "66", backgroundColor: Colors.goldMuted },
  handoffOptionIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "#0A0A0A",
    justifyContent: "center",
    alignItems: "center",
  },
  handoffOptionInfo: { flex: 1 },
  handoffOptionTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: "#FFFFFF", marginBottom: 6 },
  handoffOptionDesc: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#8A8A8A", lineHeight: 20 },
  confirmHandoffBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: GOLD,
    paddingVertical: 15,
    borderRadius: 12,
  },
  confirmHandoffBtnText: { fontSize: 16, fontFamily: "Inter_700Bold", color: "#0A0A0A" },
  draftWrap: {
    backgroundColor: "#1A1A1A",
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  draftText: { fontSize: 14, fontFamily: "Inter_400Regular", color: "#CCCCCC", lineHeight: 24 },
  tabsScroll: { maxHeight: 48, marginBottom: 4 },
  modalSubtitle: { fontSize: 12, fontFamily: "Inter_400Regular", color: "#8A8A8A", marginTop: 2 },
  turnProgressWrap: { marginTop: 10, marginBottom: 6 },
  turnProgressText: { fontSize: 12, fontFamily: "Inter_400Regular", color: "#8A8A8A", marginBottom: 4 },
  turnProgressBar: { height: 4, backgroundColor: "#2A2A2A", borderRadius: 2 },
  turnProgressFill: { height: 4, backgroundColor: GOLD, borderRadius: 2 },
  questionWrap: { backgroundColor: "#141414", borderRadius: 12, padding: 14, marginTop: 10, borderLeftWidth: 2, borderLeftColor: GOLD },
  questionHeader: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 },
  questionLabel: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: GOLD, textTransform: "uppercase" },
  questionText: { fontSize: 14, fontFamily: "Inter_400Regular", color: "#DDDDDD", lineHeight: 22 },
  answerBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: GOLD,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    marginTop: 12,
    alignSelf: "flex-start",
  },
  answerBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#0A0A0A" },
  questionWrapModal: { backgroundColor: "#141414", borderRadius: 12, padding: 16, marginBottom: 16, borderLeftWidth: 2, borderLeftColor: GOLD },
  questionLabelModal: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: GOLD, marginBottom: 8 },
  questionTextModal: { fontSize: 16, fontFamily: "Inter_400Regular", color: "#FFFFFF", lineHeight: 26 },
  incomingBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    backgroundColor: Colors.goldMuted,
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
  },
  incomingBannerText: { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", color: GOLD, lineHeight: 18 },
});
