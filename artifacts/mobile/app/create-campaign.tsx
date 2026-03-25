import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import Colors from "@/constants/colors";
import { useApp } from "@/context/AppContext";

const GOLD = Colors.gold;

interface ContactList {
  id: string;
  name: string;
  contactCount: string;
}

type Step = 1 | 2 | 3 | 4;

export default function CreateCampaignScreen() {
  const router = useRouter();
  const { token, activeBusinessId } = useApp();
  const queryClient = useQueryClient();

  const [step, setStep] = useState<Step>(1);
  const [campaignName, setCampaignName] = useState("");
  const [campaignType] = useState("email");
  const [selectedListId, setSelectedListId] = useState<string | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [scheduleMode, setScheduleMode] = useState<"now" | "schedule">("now");
  const [scheduledDate, setScheduledDate] = useState(new Date(Date.now() + 3600000));

  const apiBase = `https://${process.env["EXPO_PUBLIC_DOMAIN"]}/api`;
  const headers = { Authorization: `Bearer ${token ?? ""}`, "Content-Type": "application/json" };

  const { data: contactLists = [], isLoading: listsLoading } = useQuery<ContactList[]>({
    queryKey: ["contact-lists", activeBusinessId],
    queryFn: async () => {
      if (!activeBusinessId) return [];
      const resp = await fetch(`${apiBase}/contacts/list?businessId=${activeBusinessId}`, { headers });
      return resp.ok ? resp.json() : [];
    },
    enabled: !!token && !!activeBusinessId,
  });

  const selectedList = contactLists.find((l) => l.id === selectedListId);

  const canProceed = () => {
    switch (step) {
      case 1: return campaignName.trim().length > 0;
      case 2: return selectedListId !== null;
      case 3: return subject.trim().length > 0 && body.trim().length > 0;
      case 4: return true;
      default: return false;
    }
  };

  const handleSend = async () => {
    if (!activeBusinessId) return;
    setSending(true);
    try {
      const createResp = await fetch(`${apiBase}/campaigns`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          businessId: activeBusinessId,
          name: campaignName.trim(),
          type: campaignType,
          listId: selectedListId,
          subject: subject.trim(),
          messageTemplate: body,
        }),
      });

      if (!createResp.ok) {
        const err = await createResp.json();
        Alert.alert("Error", err.error ?? "Failed to create campaign");
        return;
      }

      const campaign = await createResp.json();

      if (scheduleMode === "schedule") {
        const schedResp = await fetch(`${apiBase}/campaigns/${campaign.id}/schedule`, {
          method: "POST",
          headers,
          body: JSON.stringify({ scheduledStart: scheduledDate.toISOString() }),
        });
        if (!schedResp.ok) {
          Alert.alert("Warning", "Campaign created but scheduling failed");
        }
        queryClient.invalidateQueries({ queryKey: ["campaigns"] });
        Alert.alert("Scheduled", `Campaign "${campaignName}" scheduled successfully.`);
        router.back();
        return;
      }

      const sendResp = await fetch(`${apiBase}/campaigns/${campaign.id}/send`, {
        method: "POST",
        headers,
      });

      const sendData = await sendResp.json();
      if (!sendResp.ok) {
        Alert.alert("Error", sendData.error ?? "Failed to send campaign");
        queryClient.invalidateQueries({ queryKey: ["campaigns"] });
        router.back();
        return;
      }

      queryClient.invalidateQueries({ queryKey: ["campaigns"] });
      Alert.alert(
        "Campaign Sent",
        `${sendData.sendResult?.sent ?? 0} emails sent, ${sendData.sendResult?.failed ?? 0} failed.`,
      );
      router.back();
    } catch {
      Alert.alert("Error", "Network error. Please try again.");
    } finally {
      setSending(false);
    }
  };

  const renderStep1 = () => (
    <View style={styles.stepContent}>
      <View style={styles.stepHeader}>
        <View style={styles.stepBadge}>
          <Text style={styles.stepBadgeText}>1</Text>
        </View>
        <Text style={styles.stepTitle}>Campaign Details</Text>
      </View>

      <Text style={styles.fieldLabel}>Campaign Name</Text>
      <TextInput
        style={styles.textInput}
        value={campaignName}
        onChangeText={setCampaignName}
        placeholder="e.g. Spring Newsletter"
        placeholderTextColor="#555"
        autoFocus
      />

      <Text style={styles.fieldLabel}>Channel</Text>
      <View style={styles.typeSelector}>
        <View style={[styles.typeOption, styles.typeOptionActive]}>
          <Feather name="mail" size={18} color="#0A0A0A" />
          <Text style={[styles.typeOptionText, styles.typeOptionTextActive]}>Email</Text>
        </View>
        <View style={[styles.typeOption, styles.typeOptionDisabled]}>
          <Feather name="message-circle" size={18} color="#555" />
          <Text style={[styles.typeOptionText, styles.typeOptionTextDisabled]}>WhatsApp</Text>
          <Text style={styles.comingSoonBadge}>Soon</Text>
        </View>
      </View>
    </View>
  );

  const renderStep2 = () => (
    <View style={styles.stepContent}>
      <View style={styles.stepHeader}>
        <View style={styles.stepBadge}>
          <Text style={styles.stepBadgeText}>2</Text>
        </View>
        <Text style={styles.stepTitle}>Select Audience</Text>
      </View>

      {listsLoading ? (
        <ActivityIndicator color={GOLD} style={{ marginTop: 20 }} />
      ) : contactLists.length === 0 ? (
        <View style={styles.emptyState}>
          <Feather name="users" size={32} color="#2A2A2A" />
          <Text style={styles.emptyTitle}>No contact lists</Text>
          <Text style={styles.emptySubtitle}>Create a contact list in Communications first</Text>
        </View>
      ) : (
        <View style={styles.listOptions}>
          {contactLists.map((list) => (
            <TouchableOpacity
              key={list.id}
              style={[styles.listOption, selectedListId === list.id && styles.listOptionActive]}
              onPress={() => setSelectedListId(list.id)}
            >
              <View style={styles.listOptionLeft}>
                <View style={[styles.radio, selectedListId === list.id && styles.radioActive]}>
                  {selectedListId === list.id && <View style={styles.radioInner} />}
                </View>
                <View>
                  <Text style={[styles.listOptionName, selectedListId === list.id && styles.listOptionNameActive]}>
                    {list.name}
                  </Text>
                  <Text style={styles.listOptionCount}>
                    {list.contactCount} contact{list.contactCount === "1" ? "" : "s"}
                  </Text>
                </View>
              </View>
              <Feather name="users" size={16} color={selectedListId === list.id ? GOLD : "#555"} />
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );

  const renderStep3 = () => (
    <View style={styles.stepContent}>
      <View style={styles.stepHeader}>
        <View style={styles.stepBadge}>
          <Text style={styles.stepBadgeText}>3</Text>
        </View>
        <Text style={styles.stepTitle}>Compose Email</Text>
      </View>

      <Text style={styles.fieldLabel}>Subject Line</Text>
      <TextInput
        style={styles.textInput}
        value={subject}
        onChangeText={setSubject}
        placeholder="e.g. Exciting news from our team!"
        placeholderTextColor="#555"
      />
      <Text style={styles.charCount}>{subject.length} characters</Text>

      <Text style={styles.fieldLabel}>Email Body</Text>
      <TextInput
        style={[styles.textInput, styles.textArea]}
        value={body}
        onChangeText={setBody}
        placeholder="Write your email content here..."
        placeholderTextColor="#555"
        multiline
        textAlignVertical="top"
      />
      <Text style={styles.charCount}>{body.length} characters</Text>

      <View style={styles.tipCard}>
        <Feather name="info" size={14} color={GOLD} />
        <Text style={styles.tipText}>
          Tip: Keep your subject under 60 characters for best open rates. You can use basic HTML for formatting.
        </Text>
      </View>
    </View>
  );

  const renderStep4 = () => (
    <View style={styles.stepContent}>
      <View style={styles.stepHeader}>
        <View style={styles.stepBadge}>
          <Text style={styles.stepBadgeText}>4</Text>
        </View>
        <Text style={styles.stepTitle}>Review & Send</Text>
      </View>

      <View style={styles.reviewCard}>
        <View style={styles.reviewRow}>
          <Text style={styles.reviewLabel}>Campaign</Text>
          <Text style={styles.reviewValue}>{campaignName}</Text>
        </View>
        <View style={styles.reviewRow}>
          <Text style={styles.reviewLabel}>Channel</Text>
          <Text style={styles.reviewValue}>Email</Text>
        </View>
        <View style={styles.reviewRow}>
          <Text style={styles.reviewLabel}>Audience</Text>
          <Text style={styles.reviewValue}>
            {selectedList?.name ?? "—"} ({selectedList?.contactCount ?? 0} contacts)
          </Text>
        </View>
        <View style={styles.reviewRow}>
          <Text style={styles.reviewLabel}>Subject</Text>
          <Text style={styles.reviewValue} numberOfLines={2}>{subject}</Text>
        </View>
        <View style={styles.reviewRow}>
          <Text style={styles.reviewLabel}>Preview</Text>
          <Text style={styles.reviewValue} numberOfLines={3}>{body.replace(/<[^>]*>/g, "").slice(0, 120)}...</Text>
        </View>
      </View>

      <Text style={styles.fieldLabel}>When to send</Text>
      <View style={styles.scheduleOptions}>
        <TouchableOpacity
          style={[styles.scheduleOption, scheduleMode === "now" && styles.scheduleOptionActive]}
          onPress={() => setScheduleMode("now")}
        >
          <Feather name="send" size={16} color={scheduleMode === "now" ? "#0A0A0A" : "#8A8A8A"} />
          <Text style={[styles.scheduleOptionText, scheduleMode === "now" && styles.scheduleOptionTextActive]}>
            Send Now
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.scheduleOption, scheduleMode === "schedule" && styles.scheduleOptionActive]}
          onPress={() => setScheduleMode("schedule")}
        >
          <Feather name="clock" size={16} color={scheduleMode === "schedule" ? "#0A0A0A" : "#8A8A8A"} />
          <Text style={[styles.scheduleOptionText, scheduleMode === "schedule" && styles.scheduleOptionTextActive]}>
            Schedule
          </Text>
        </TouchableOpacity>
      </View>

      {scheduleMode === "schedule" && (
        <View style={styles.scheduleDateContainer}>
          <View style={styles.datePickerBtn}>
            <Feather name="calendar" size={16} color={GOLD} />
            <Text style={styles.datePickerText}>
              {scheduledDate.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
              {" "}
              {scheduledDate.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
            </Text>
          </View>
          <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
            <TouchableOpacity
              style={styles.dateAdjustBtn}
              onPress={() => setScheduledDate(new Date(scheduledDate.getTime() + 3600000))}
            >
              <Text style={styles.dateAdjustText}>+1 hour</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.dateAdjustBtn}
              onPress={() => setScheduledDate(new Date(scheduledDate.getTime() + 86400000))}
            >
              <Text style={styles.dateAdjustText}>+1 day</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.dateAdjustBtn}
              onPress={() => setScheduledDate(new Date(scheduledDate.getTime() + 604800000))}
            >
              <Text style={styles.dateAdjustText}>+1 week</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      <View style={styles.costNote}>
        <Feather name="credit-card" size={14} color={GOLD} />
        <Text style={styles.costText}>
          Cost: 1 credit per email sent ({selectedList?.contactCount ?? 0} contacts)
        </Text>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => step > 1 ? setStep((step - 1) as Step) : router.back()}>
          <Feather name={step > 1 ? "arrow-left" : "x"} size={22} color="#FFFFFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>New Campaign</Text>
        <View style={{ width: 22 }} />
      </View>

      <View style={styles.progressBar}>
        {[1, 2, 3, 4].map((s) => (
          <View
            key={s}
            style={[styles.progressDot, s <= step && styles.progressDotActive, s === step && styles.progressDotCurrent]}
          />
        ))}
      </View>

      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
        {step === 1 && renderStep1()}
        {step === 2 && renderStep2()}
        {step === 3 && renderStep3()}
        {step === 4 && renderStep4()}
      </ScrollView>

      <View style={styles.footer}>
        {step < 4 ? (
          <TouchableOpacity
            style={[styles.nextBtn, !canProceed() && styles.nextBtnDisabled]}
            onPress={() => setStep((step + 1) as Step)}
            disabled={!canProceed()}
          >
            <Text style={styles.nextBtnText}>Continue</Text>
            <Feather name="arrow-right" size={18} color="#0A0A0A" />
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.sendBtn, sending && styles.sendBtnDisabled]}
            onPress={handleSend}
            disabled={sending}
          >
            {sending ? (
              <ActivityIndicator color="#0A0A0A" />
            ) : (
              <>
                <Feather name={scheduleMode === "now" ? "send" : "clock"} size={18} color="#0A0A0A" />
                <Text style={styles.sendBtnText}>
                  {scheduleMode === "now" ? "Send Campaign" : "Schedule Campaign"}
                </Text>
              </>
            )}
          </TouchableOpacity>
        )}
      </View>
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
  },
  headerTitle: { fontSize: 18, fontFamily: "Inter_600SemiBold", color: "#FFFFFF" },
  progressBar: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 8,
    paddingBottom: 16,
  },
  progressDot: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#2A2A2A",
  },
  progressDotActive: { backgroundColor: GOLD + "66" },
  progressDotCurrent: { backgroundColor: GOLD },
  scroll: { flex: 1 },
  stepContent: { paddingHorizontal: 20, paddingBottom: 40 },
  stepHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 24,
  },
  stepBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: GOLD,
    justifyContent: "center",
    alignItems: "center",
  },
  stepBadgeText: { fontSize: 14, fontFamily: "Inter_700Bold", color: "#0A0A0A" },
  stepTitle: { fontSize: 20, fontFamily: "Inter_700Bold", color: "#FFFFFF" },
  fieldLabel: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    color: "#8A8A8A",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 8,
    marginTop: 16,
  },
  textInput: {
    backgroundColor: "#1A1A1A",
    borderColor: "#2A2A2A",
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    fontSize: 16,
    fontFamily: "Inter_400Regular",
    color: "#FFFFFF",
  },
  textArea: { minHeight: 160, maxHeight: 300 },
  charCount: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: "#555",
    textAlign: "right",
    marginTop: 4,
  },
  typeSelector: { flexDirection: "row", gap: 12, marginTop: 4 },
  typeOption: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#2A2A2A",
    backgroundColor: "#1A1A1A",
  },
  typeOptionActive: { backgroundColor: GOLD, borderColor: GOLD },
  typeOptionDisabled: { opacity: 0.5 },
  typeOptionText: { fontSize: 15, fontFamily: "Inter_500Medium", color: "#8A8A8A" },
  typeOptionTextActive: { color: "#0A0A0A" },
  typeOptionTextDisabled: { color: "#555" },
  comingSoonBadge: {
    fontSize: 10,
    fontFamily: "Inter_600SemiBold",
    color: "#555",
    backgroundColor: "#2A2A2A",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  emptyState: {
    alignItems: "center",
    paddingVertical: 40,
    gap: 8,
  },
  emptyTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: "#8A8A8A" },
  emptySubtitle: { fontSize: 14, fontFamily: "Inter_400Regular", color: "#555", textAlign: "center" },
  listOptions: { gap: 8, marginTop: 4 },
  listOption: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#2A2A2A",
    backgroundColor: "#1A1A1A",
  },
  listOptionActive: { borderColor: GOLD, backgroundColor: "#1A1A0A" },
  listOptionLeft: { flexDirection: "row", alignItems: "center", gap: 12 },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: "#555",
    justifyContent: "center",
    alignItems: "center",
  },
  radioActive: { borderColor: GOLD },
  radioInner: { width: 10, height: 10, borderRadius: 5, backgroundColor: GOLD },
  listOptionName: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#FFFFFF" },
  listOptionNameActive: { color: GOLD },
  listOptionCount: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#8A8A8A", marginTop: 2 },
  tipCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    backgroundColor: "#1A1A0A",
    borderColor: GOLD + "33",
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginTop: 16,
  },
  tipText: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", color: "#8A8A8A" },
  reviewCard: {
    backgroundColor: "#1A1A1A",
    borderColor: "#2A2A2A",
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
    gap: 14,
  },
  reviewRow: { gap: 4 },
  reviewLabel: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    color: "#555",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  reviewValue: { fontSize: 15, fontFamily: "Inter_400Regular", color: "#FFFFFF" },
  scheduleOptions: { flexDirection: "row", gap: 12, marginTop: 4 },
  scheduleOption: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#2A2A2A",
    backgroundColor: "#1A1A1A",
  },
  scheduleOptionActive: { backgroundColor: GOLD, borderColor: GOLD },
  scheduleOptionText: { fontSize: 15, fontFamily: "Inter_500Medium", color: "#8A8A8A" },
  scheduleOptionTextActive: { color: "#0A0A0A" },
  scheduleDateContainer: { marginTop: 12 },
  datePickerBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#1A1A1A",
    borderColor: "#2A2A2A",
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
  },
  datePickerText: { fontSize: 15, fontFamily: "Inter_400Regular", color: "#FFFFFF" },
  dateAdjustBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: "#1A1A1A",
    borderColor: "#2A2A2A",
    borderWidth: 1,
  },
  dateAdjustText: { fontSize: 13, fontFamily: "Inter_500Medium", color: GOLD },
  costNote: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#1A1A0A",
    borderColor: GOLD + "33",
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginTop: 16,
  },
  costText: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", color: "#8A8A8A" },
  footer: {
    padding: 20,
    borderTopWidth: 1,
    borderTopColor: "#1A1A1A",
  },
  nextBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: GOLD,
    borderRadius: 12,
    padding: 16,
  },
  nextBtnDisabled: { opacity: 0.4 },
  nextBtnText: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: "#0A0A0A" },
  sendBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: GOLD,
    borderRadius: 12,
    padding: 16,
  },
  sendBtnDisabled: { opacity: 0.6 },
  sendBtnText: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: "#0A0A0A" },
});
