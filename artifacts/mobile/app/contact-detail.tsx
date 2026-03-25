import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
  Modal,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useApp } from "@/context/AppContext";
import Colors from "@/constants/colors";

const GOLD = Colors.gold;

interface Contact {
  id: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  tags: string[];
  consentGiven: boolean;
  consentAt?: string | null;
  dncListed: boolean;
  createdAt: string;
}

interface Note {
  id: string;
  contactId: string;
  text: string;
  createdAt: string;
}

function formatDate(iso: string) {
  const d = new Date(iso);
  return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export default function ContactDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { token } = useApp();
  const queryClient = useQueryClient();

  const apiBase = `https://${process.env["EXPO_PUBLIC_DOMAIN"]}/api`;
  const headers = { Authorization: `Bearer ${token ?? ""}`, "Content-Type": "application/json" };

  const [editMode, setEditMode] = useState(false);
  const [editName, setEditName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [newTag, setNewTag] = useState("");
  const [noteText, setNoteText] = useState("");
  const [showAddTagInput, setShowAddTagInput] = useState(false);
  const [saving, setSaving] = useState(false);

  const { data: contact, isLoading } = useQuery<Contact>({
    queryKey: ["contact", id],
    queryFn: async () => {
      const resp = await fetch(`${apiBase}/contacts/${id}`, { headers });
      if (!resp.ok) throw new Error("Failed to load contact");
      return resp.json();
    },
    enabled: !!id && !!token,
  });

  const { data: notes = [], isLoading: notesLoading } = useQuery<Note[]>({
    queryKey: ["contact-notes", id],
    queryFn: async () => {
      const resp = await fetch(`${apiBase}/contacts/${id}/notes`, { headers });
      return resp.ok ? resp.json() : [];
    },
    enabled: !!id && !!token,
  });

  const patchContact = useMutation({
    mutationFn: async (data: Partial<Contact>) => {
      const resp = await fetch(`${apiBase}/contacts/${id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify(data),
      });
      if (!resp.ok) {
        const err = await resp.json();
        throw new Error(err.error ?? "Failed to update contact");
      }
      return resp.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["contact", id] });
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
    },
    onError: (err: Error) => Alert.alert("Error", err.message),
  });

  const addNote = useMutation({
    mutationFn: async (text: string) => {
      const resp = await fetch(`${apiBase}/contacts/${id}/notes`, {
        method: "POST",
        headers,
        body: JSON.stringify({ text }),
      });
      if (!resp.ok) throw new Error("Failed to add note");
      return resp.json();
    },
    onSuccess: () => {
      setNoteText("");
      queryClient.invalidateQueries({ queryKey: ["contact-notes", id] });
    },
    onError: (err: Error) => Alert.alert("Error", err.message),
  });

  const enterEditMode = useCallback(() => {
    if (!contact) return;
    setEditName(contact.name);
    setEditPhone(contact.phone ?? "");
    setEditEmail(contact.email ?? "");
    setEditMode(true);
  }, [contact]);

  const saveEdit = async () => {
    if (!editName.trim()) {
      Alert.alert("Error", "Name is required");
      return;
    }
    setSaving(true);
    try {
      await patchContact.mutateAsync({
        name: editName.trim(),
        phone: editPhone.trim() || null,
        email: editEmail.trim() || null,
      });
      setEditMode(false);
    } finally {
      setSaving(false);
    }
  };

  const handleAddTag = async () => {
    if (!newTag.trim() || !contact) return;
    const newTags = [...(contact.tags ?? []), newTag.trim().toLowerCase()];
    await patchContact.mutateAsync({ tags: newTags });
    setNewTag("");
    setShowAddTagInput(false);
  };

  const handleRemoveTag = (tag: string) => {
    if (!contact) return;
    Alert.alert("Remove Tag", `Remove tag "${tag}"?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: () => patchContact.mutate({ tags: contact.tags.filter((t) => t !== tag) }),
      },
    ]);
  };

  const handleToggleConsent = () => {
    if (!contact) return;
    const newValue = !contact.consentGiven;
    Alert.alert(
      newValue ? "Give Consent" : "Revoke Consent",
      newValue
        ? "Mark this contact as having given consent to be contacted?"
        : "Revoke consent for this contact?",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Confirm", onPress: () => patchContact.mutate({ consentGiven: newValue }) },
      ],
    );
  };

  const handleToggleDNC = () => {
    if (!contact) return;
    const newValue = !contact.dncListed;
    Alert.alert(
      newValue ? "Add to DNC" : "Remove from DNC",
      newValue
        ? "Add this contact to the Do Not Contact list?"
        : "Remove this contact from the Do Not Contact list?",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Confirm", style: newValue ? "destructive" : "default", onPress: () => patchContact.mutate({ dncListed: newValue }) },
      ],
    );
  };

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator color={GOLD} style={{ marginTop: 40 }} />
      </SafeAreaView>
    );
  }

  if (!contact) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.emptyText}>Contact not found.</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="arrow-left" size={22} color="#FFFFFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{contact.name}</Text>
        {editMode ? (
          <TouchableOpacity onPress={saveEdit} style={styles.editBtn} disabled={saving}>
            {saving ? <ActivityIndicator size="small" color={GOLD} /> : <Text style={styles.editBtnText}>Save</Text>}
          </TouchableOpacity>
        ) : (
          <TouchableOpacity onPress={enterEditMode} style={styles.editBtn}>
            <Feather name="edit-2" size={16} color={GOLD} />
          </TouchableOpacity>
        )}
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
          {/* Avatar + basic info */}
          <View style={styles.avatarSection}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{contact.name.charAt(0).toUpperCase()}</Text>
            </View>
          </View>

          {/* Basic fields */}
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Contact Info</Text>
            {editMode ? (
              <>
                <View style={styles.fieldRow}>
                  <Text style={styles.fieldLabel}>Name</Text>
                  <TextInput
                    style={styles.fieldInput}
                    value={editName}
                    onChangeText={setEditName}
                    placeholder="Full name"
                    placeholderTextColor="#555"
                  />
                </View>
                <View style={styles.fieldRow}>
                  <Text style={styles.fieldLabel}>Phone</Text>
                  <TextInput
                    style={styles.fieldInput}
                    value={editPhone}
                    onChangeText={setEditPhone}
                    placeholder="+447700900000"
                    placeholderTextColor="#555"
                    keyboardType="phone-pad"
                  />
                </View>
                <View style={styles.fieldRow}>
                  <Text style={styles.fieldLabel}>Email</Text>
                  <TextInput
                    style={styles.fieldInput}
                    value={editEmail}
                    onChangeText={setEditEmail}
                    placeholder="email@example.com"
                    placeholderTextColor="#555"
                    keyboardType="email-address"
                    autoCapitalize="none"
                  />
                </View>
              </>
            ) : (
              <>
                <View style={styles.fieldRow}>
                  <Text style={styles.fieldLabel}>Phone</Text>
                  <Text style={styles.fieldValue}>{contact.phone ?? "—"}</Text>
                </View>
                <View style={styles.fieldRow}>
                  <Text style={styles.fieldLabel}>Email</Text>
                  <Text style={styles.fieldValue}>{contact.email ?? "—"}</Text>
                </View>
                <View style={styles.fieldRow}>
                  <Text style={styles.fieldLabel}>Added</Text>
                  <Text style={styles.fieldValue}>{formatDate(contact.createdAt)}</Text>
                </View>
              </>
            )}
          </View>

          {/* Consent & DNC */}
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Status</Text>
            <TouchableOpacity style={styles.statusRow} onPress={handleToggleConsent}>
              <View style={styles.statusLeft}>
                <View style={[styles.statusBadge, contact.consentGiven ? styles.consentBadge : styles.noConsentBadge]}>
                  <Text style={styles.statusBadgeText}>
                    {contact.consentGiven ? "Consent Given" : "No Consent"}
                  </Text>
                </View>
                {contact.consentGiven && contact.consentAt && (
                  <Text style={styles.consentDate}>Given {formatDate(contact.consentAt)}</Text>
                )}
              </View>
              <Feather name="refresh-cw" size={14} color="#555" />
            </TouchableOpacity>

            <TouchableOpacity style={[styles.statusRow, { marginTop: 10 }]} onPress={handleToggleDNC}>
              <View style={[styles.statusBadge, contact.dncListed ? styles.dncBadge : styles.okBadge]}>
                <Text style={styles.statusBadgeText}>
                  {contact.dncListed ? "DNC Listed" : "OK to Contact"}
                </Text>
              </View>
              <Feather name="refresh-cw" size={14} color="#555" />
            </TouchableOpacity>
          </View>

          {/* Tags */}
          <View style={styles.card}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Tags</Text>
              <TouchableOpacity onPress={() => setShowAddTagInput(!showAddTagInput)}>
                <Feather name="plus" size={18} color={GOLD} />
              </TouchableOpacity>
            </View>
            <View style={styles.tagsRow}>
              {(contact.tags ?? []).length === 0 && !showAddTagInput && (
                <Text style={styles.emptyText}>No tags yet</Text>
              )}
              {(contact.tags ?? []).map((tag) => (
                <TouchableOpacity key={tag} style={styles.tag} onPress={() => handleRemoveTag(tag)}>
                  <Text style={styles.tagText}>{tag}</Text>
                  <Feather name="x" size={12} color="#8A8A8A" style={{ marginLeft: 4 }} />
                </TouchableOpacity>
              ))}
            </View>
            {showAddTagInput && (
              <View style={styles.addTagRow}>
                <TextInput
                  style={styles.tagInput}
                  value={newTag}
                  onChangeText={setNewTag}
                  placeholder="e.g. VIP, lead, cold"
                  placeholderTextColor="#555"
                  autoCapitalize="none"
                  onSubmitEditing={handleAddTag}
                />
                <TouchableOpacity style={styles.tagAddBtn} onPress={handleAddTag}>
                  <Text style={styles.tagAddBtnText}>Add</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>

          {/* Notes */}
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Notes</Text>
            <View style={styles.addNoteRow}>
              <TextInput
                style={styles.noteInput}
                value={noteText}
                onChangeText={setNoteText}
                placeholder="Add a note..."
                placeholderTextColor="#555"
                multiline
              />
              <TouchableOpacity
                style={[styles.noteAddBtn, !noteText.trim() && styles.noteAddBtnDisabled]}
                onPress={() => { if (noteText.trim()) addNote.mutate(noteText.trim()); }}
                disabled={!noteText.trim() || addNote.isPending}
              >
                {addNote.isPending ? (
                  <ActivityIndicator size="small" color="#0A0A0A" />
                ) : (
                  <Feather name="send" size={16} color="#0A0A0A" />
                )}
              </TouchableOpacity>
            </View>
            {notesLoading ? (
              <ActivityIndicator color={GOLD} style={{ marginTop: 12 }} />
            ) : notes.length === 0 ? (
              <Text style={[styles.emptyText, { marginTop: 8 }]}>No notes yet</Text>
            ) : (
              notes.map((note) => (
                <View key={note.id} style={styles.noteCard}>
                  <Text style={styles.noteText}>{note.text}</Text>
                  <Text style={styles.noteMeta}>{formatDate(note.createdAt)}</Text>
                </View>
              ))
            )}
          </View>

          <View style={{ height: 40 }} />
        </ScrollView>
      </KeyboardAvoidingView>
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
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#1A1A1A",
  },
  backBtn: {
    padding: 4,
    marginRight: 12,
  },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontFamily: "Inter_600SemiBold",
    color: "#FFFFFF",
  },
  editBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  editBtnText: {
    color: GOLD,
    fontFamily: "Inter_600SemiBold",
    fontSize: 15,
  },
  scroll: {
    flex: 1,
  },
  avatarSection: {
    alignItems: "center",
    paddingVertical: 24,
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: "#1A1A1A",
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 2,
    borderColor: GOLD,
  },
  avatarText: {
    fontSize: 28,
    fontFamily: "Inter_700Bold",
    color: GOLD,
  },
  card: {
    backgroundColor: "#111111",
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: "#1A1A1A",
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    color: "#8A8A8A",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 12,
  },
  fieldRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 10,
  },
  fieldLabel: {
    width: 60,
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    color: "#8A8A8A",
  },
  fieldValue: {
    flex: 1,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    color: "#FFFFFF",
  },
  fieldInput: {
    flex: 1,
    backgroundColor: "#1A1A1A",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    color: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#2A2A2A",
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  statusLeft: {
    flexDirection: "column",
  },
  statusBadge: {
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    alignSelf: "flex-start",
  },
  statusBadgeText: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },
  consentBadge: {
    backgroundColor: "rgba(34,197,94,0.15)",
  },
  noConsentBadge: {
    backgroundColor: "rgba(138,138,138,0.15)",
  },
  dncBadge: {
    backgroundColor: "rgba(239,68,68,0.15)",
  },
  okBadge: {
    backgroundColor: "rgba(34,197,94,0.1)",
  },
  consentDate: {
    fontSize: 11,
    color: "#555",
    marginTop: 3,
    fontFamily: "Inter_400Regular",
  },
  tagsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  tag: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1A1A1A",
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: "#2A2A2A",
  },
  tagText: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    color: "#CCCCCC",
  },
  addTagRow: {
    flexDirection: "row",
    marginTop: 10,
    gap: 8,
  },
  tagInput: {
    flex: 1,
    backgroundColor: "#1A1A1A",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#2A2A2A",
  },
  tagAddBtn: {
    backgroundColor: GOLD,
    borderRadius: 8,
    paddingHorizontal: 16,
    justifyContent: "center",
  },
  tagAddBtnText: {
    color: "#0A0A0A",
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
  },
  addNoteRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 12,
  },
  noteInput: {
    flex: 1,
    backgroundColor: "#1A1A1A",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#2A2A2A",
    minHeight: 44,
  },
  noteAddBtn: {
    backgroundColor: GOLD,
    borderRadius: 8,
    width: 44,
    justifyContent: "center",
    alignItems: "center",
  },
  noteAddBtnDisabled: {
    backgroundColor: "#2A2A2A",
  },
  noteCard: {
    backgroundColor: "#1A1A1A",
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
  },
  noteText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: "#FFFFFF",
    lineHeight: 20,
  },
  noteMeta: {
    fontSize: 11,
    color: "#555",
    marginTop: 6,
    fontFamily: "Inter_400Regular",
  },
  emptyText: {
    fontSize: 14,
    color: "#555",
    fontFamily: "Inter_400Regular",
  },
});
