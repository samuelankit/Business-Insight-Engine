import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  Modal,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Colors from "@/constants/colors";
import { useApp } from "@/context/AppContext";

const GOLD = Colors.gold;

interface Contact {
  id: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  consentGiven: boolean;
  dncListed: boolean;
  tags: string[];
}

interface Campaign {
  id: string;
  name: string;
  type: string;
  status: string;
  sentCount: number;
  deliveredCount: number;
  createdAt: string;
}

type Tab = "contacts" | "campaigns";

export default function CommunicationsScreen() {
  const { token, activeBusinessId } = useApp();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<Tab>("contacts");
  const [showAddContact, setShowAddContact] = useState(false);
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [contactEmail, setContactEmail] = useState("");

  const apiBase = `https://${process.env["EXPO_PUBLIC_DOMAIN"]}/api`;
  const headers = { Authorization: `Bearer ${token ?? ""}`, "Content-Type": "application/json" };

  const { data: contactsData, isLoading: contactsLoading } = useQuery<{ contacts: Contact[]; total: number }>({
    queryKey: ["contacts", activeBusinessId],
    queryFn: async () => {
      if (!activeBusinessId) return { contacts: [], total: 0 };
      const resp = await fetch(`${apiBase}/contacts?businessId=${activeBusinessId}&limit=50`, { headers });
      return resp.ok ? resp.json() : { contacts: [], total: 0 };
    },
    enabled: !!token && !!activeBusinessId,
  });

  const { data: campaigns = [], isLoading: campaignsLoading } = useQuery<Campaign[]>({
    queryKey: ["campaigns", activeBusinessId],
    queryFn: async () => {
      if (!activeBusinessId) return [];
      const resp = await fetch(`${apiBase}/campaigns?businessId=${activeBusinessId}`, { headers });
      return resp.ok ? resp.json() : [];
    },
    enabled: !!token && !!activeBusinessId,
  });

  const createContact = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {
        businessId: activeBusinessId,
        name: contactName.trim(),
        consentGiven: true,
      };
      if (contactPhone.trim()) body.phone = contactPhone.trim();
      if (contactEmail.trim()) body.email = contactEmail.trim();

      const resp = await fetch(`${apiBase}/contacts`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
      if (!resp.ok) {
        const err = await resp.json();
        throw new Error(err.error ?? "Failed to create contact");
      }
      return resp.json();
    },
    onSuccess: () => {
      setShowAddContact(false);
      setContactName("");
      setContactPhone("");
      setContactEmail("");
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
    },
    onError: (err: Error) => {
      Alert.alert("Error", err.message);
    },
  });

  const deleteContact = useMutation({
    mutationFn: async (contactId: string) => {
      await fetch(`${apiBase}/contacts/${contactId}`, { method: "DELETE", headers });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["contacts"] }),
  });

  const statusColor = (status: string) => {
    switch (status) {
      case "running": return "#22C55E";
      case "paused": return "#F59E0B";
      case "failed": return "#EF4444";
      case "completed": return "#8A8A8A";
      default: return "#555";
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Communications</Text>
        {activeTab === "contacts" && (
          <TouchableOpacity style={styles.addBtn} onPress={() => setShowAddContact(true)}>
            <Feather name="plus" size={18} color="#0A0A0A" />
          </TouchableOpacity>
        )}
      </View>

      {/* Tabs */}
      <View style={styles.tabs}>
        {(["contacts", "campaigns"] as Tab[]).map((tab) => (
          <TouchableOpacity
            key={tab}
            style={[styles.tab, activeTab === tab && styles.activeTab]}
            onPress={() => setActiveTab(tab)}
          >
            <Text style={[styles.tabText, activeTab === tab && styles.activeTabText]}>
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Content */}
      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
        {activeTab === "contacts" ? (
          contactsLoading ? (
            <Text style={styles.emptyText}>Loading...</Text>
          ) : !contactsData?.contacts.length ? (
            <View style={styles.emptyState}>
              <Feather name="users" size={40} color="#2A2A2A" />
              <Text style={styles.emptyTitle}>No contacts yet</Text>
              <Text style={styles.emptySubtitle}>Add your first contact to get started with communications</Text>
              <TouchableOpacity style={styles.emptyAddBtn} onPress={() => setShowAddContact(true)}>
                <Text style={styles.emptyAddBtnText}>Add Contact</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.listContainer}>
              {contactsData.contacts.map((contact) => (
                <View key={contact.id} style={styles.contactCard}>
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>{contact.name.charAt(0).toUpperCase()}</Text>
                  </View>
                  <View style={styles.contactInfo}>
                    <Text style={styles.contactName}>{contact.name}</Text>
                    <Text style={styles.contactMeta}>
                      {contact.phone ?? contact.email ?? "No contact info"}
                    </Text>
                    <View style={styles.contactBadges}>
                      {contact.consentGiven && (
                        <View style={styles.badge}>
                          <Text style={styles.badgeText}>Consent ✓</Text>
                        </View>
                      )}
                      {contact.dncListed && (
                        <View style={[styles.badge, styles.dncBadge]}>
                          <Text style={styles.dncBadgeText}>DNC</Text>
                        </View>
                      )}
                    </View>
                  </View>
                  <TouchableOpacity
                    onPress={() => {
                      Alert.alert("Delete Contact", "Are you sure?", [
                        { text: "Cancel" },
                        { text: "Delete", style: "destructive", onPress: () => deleteContact.mutate(contact.id) },
                      ]);
                    }}
                  >
                    <Feather name="trash-2" size={16} color="#555" />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )
        ) : (
          campaignsLoading ? (
            <Text style={styles.emptyText}>Loading...</Text>
          ) : campaigns.length === 0 ? (
            <View style={styles.emptyState}>
              <Feather name="send" size={40} color="#2A2A2A" />
              <Text style={styles.emptyTitle}>No campaigns yet</Text>
              <Text style={styles.emptySubtitle}>Create your first campaign to reach your contacts</Text>
            </View>
          ) : (
            <View style={styles.listContainer}>
              {campaigns.map((campaign) => (
                <View key={campaign.id} style={styles.campaignCard}>
                  <View style={styles.campaignHeader}>
                    <Text style={styles.campaignName}>{campaign.name}</Text>
                    <View style={[styles.statusDot, { backgroundColor: statusColor(campaign.status) }]} />
                  </View>
                  <Text style={styles.campaignType}>{campaign.type.toUpperCase()} · {campaign.status}</Text>
                  <View style={styles.campaignStats}>
                    <View style={styles.statItem}>
                      <Text style={styles.statValue}>{campaign.sentCount}</Text>
                      <Text style={styles.statLabel}>Sent</Text>
                    </View>
                    <View style={styles.statItem}>
                      <Text style={styles.statValue}>{campaign.deliveredCount}</Text>
                      <Text style={styles.statLabel}>Delivered</Text>
                    </View>
                    <View style={styles.statItem}>
                      <Text style={styles.statValue}>
                        {campaign.sentCount > 0
                          ? `${Math.round((campaign.deliveredCount / campaign.sentCount) * 100)}%`
                          : "—"}
                      </Text>
                      <Text style={styles.statLabel}>Rate</Text>
                    </View>
                  </View>
                </View>
              ))}
            </View>
          )
        )}
      </ScrollView>

      {/* Add Contact Modal */}
      <Modal visible={showAddContact} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={styles.modal}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Add Contact</Text>
            <TouchableOpacity onPress={() => setShowAddContact(false)}>
              <Feather name="x" size={22} color="#FFFFFF" />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.modalContent}>
            <Text style={styles.fieldLabel}>Name *</Text>
            <TextInput
              style={styles.textInput}
              value={contactName}
              onChangeText={setContactName}
              placeholder="Full name"
              placeholderTextColor="#555"
            />

            <Text style={styles.fieldLabel}>Phone (E.164 format)</Text>
            <TextInput
              style={styles.textInput}
              value={contactPhone}
              onChangeText={setContactPhone}
              placeholder="+447700900000"
              placeholderTextColor="#555"
              keyboardType="phone-pad"
            />

            <Text style={styles.fieldLabel}>Email</Text>
            <TextInput
              style={styles.textInput}
              value={contactEmail}
              onChangeText={setContactEmail}
              placeholder="email@example.com"
              placeholderTextColor="#555"
              keyboardType="email-address"
              autoCapitalize="none"
            />

            <View style={styles.consentNote}>
              <Feather name="shield" size={14} color={GOLD} />
              <Text style={styles.consentText}>Consent will be recorded on contact creation as per PECR requirements.</Text>
            </View>
          </ScrollView>

          <View style={styles.modalFooter}>
            <TouchableOpacity
              style={[styles.createBtn, !contactName.trim() && styles.createBtnDisabled]}
              onPress={() => createContact.mutate()}
              disabled={!contactName.trim() || createContact.isPending}
            >
              <Text style={styles.createBtnText}>
                {createContact.isPending ? "Adding..." : "Add Contact"}
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
  headerTitle: { fontSize: 24, fontFamily: "Inter_700Bold", color: "#FFFFFF", letterSpacing: -0.5 },
  addBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: GOLD,
    justifyContent: "center",
    alignItems: "center",
  },
  tabs: {
    flexDirection: "row",
    paddingHorizontal: 20,
    gap: 8,
    marginBottom: 16,
  },
  tab: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: "#1A1A1A",
    borderColor: "#2A2A2A",
    borderWidth: 1,
  },
  activeTab: { backgroundColor: GOLD },
  tabText: { fontSize: 14, fontFamily: "Inter_500Medium", color: "#8A8A8A" },
  activeTabText: { color: "#0A0A0A" },
  scroll: { flex: 1 },
  listContainer: { paddingHorizontal: 20, gap: 8, paddingBottom: 20 },
  contactCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1A1A1A",
    borderColor: "#2A2A2A",
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    gap: 12,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.goldMuted,
    justifyContent: "center",
    alignItems: "center",
  },
  avatarText: { fontSize: 16, fontFamily: "Inter_700Bold", color: GOLD },
  contactInfo: { flex: 1 },
  contactName: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#FFFFFF" },
  contactMeta: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#8A8A8A", marginTop: 2 },
  contactBadges: { flexDirection: "row", gap: 6, marginTop: 6 },
  badge: {
    backgroundColor: "#22C55E22",
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeText: { fontSize: 11, fontFamily: "Inter_500Medium", color: "#22C55E" },
  dncBadge: { backgroundColor: "#EF444422" },
  dncBadgeText: { fontSize: 11, fontFamily: "Inter_500Medium", color: "#EF4444" },
  campaignCard: {
    backgroundColor: "#1A1A1A",
    borderColor: "#2A2A2A",
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
  },
  campaignHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 },
  campaignName: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#FFFFFF" },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  campaignType: { fontSize: 12, fontFamily: "Inter_400Regular", color: "#8A8A8A", marginBottom: 12 },
  campaignStats: { flexDirection: "row", gap: 24 },
  statItem: { alignItems: "center" },
  statValue: { fontSize: 18, fontFamily: "Inter_700Bold", color: "#FFFFFF" },
  statLabel: { fontSize: 11, fontFamily: "Inter_400Regular", color: "#8A8A8A", marginTop: 2 },
  emptyState: { alignItems: "center", paddingTop: 80, paddingHorizontal: 40, gap: 12 },
  emptyTitle: { fontSize: 17, fontFamily: "Inter_600SemiBold", color: "#555", marginTop: 8 },
  emptySubtitle: { fontSize: 14, fontFamily: "Inter_400Regular", color: "#444", textAlign: "center" },
  emptyText: { color: "#555", fontFamily: "Inter_400Regular", fontSize: 15, textAlign: "center", paddingTop: 40 },
  emptyAddBtn: {
    backgroundColor: GOLD,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 20,
    marginTop: 8,
  },
  emptyAddBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#0A0A0A" },
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
  consentNote: {
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: Colors.goldMuted,
    borderRadius: 10,
    padding: 12,
    gap: 8,
  },
  consentText: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", color: "#8A8A8A" },
  modalFooter: { padding: 20, borderTopColor: "#2A2A2A", borderTopWidth: StyleSheet.hairlineWidth },
  createBtn: {
    backgroundColor: GOLD,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: "center",
  },
  createBtnDisabled: { opacity: 0.5 },
  createBtnText: { fontSize: 16, fontFamily: "Inter_700Bold", color: "#0A0A0A" },
});
