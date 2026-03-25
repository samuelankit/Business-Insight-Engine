import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Modal,
  TextInput,
  ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import * as DocumentPicker from "expo-document-picker";
import Colors from "@/constants/colors";
import { useApp } from "@/context/AppContext";

const GOLD = Colors.gold;

type KnowledgeDoc = {
  id: string;
  title: string;
  businessId: string;
  agentId: string | null;
  status: string;
  chunkCount: number | null;
  createdAt: string;
};

type Agent = {
  id: string;
  name: string;
};

export default function KnowledgeScreen() {
  const router = useRouter();
  const { token, activeBusinessId } = useApp();
  const queryClient = useQueryClient();

  const [showAddSheet, setShowAddSheet] = useState(false);
  const [showPasteModal, setShowPasteModal] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [selectedDoc, setSelectedDoc] = useState<KnowledgeDoc | null>(null);
  const [pasteTitle, setPasteTitle] = useState("");
  const [pasteContent, setPasteContent] = useState("");
  const [uploading, setUploading] = useState(false);

  const apiBase = `https://${process.env["EXPO_PUBLIC_DOMAIN"]}/api`;
  const headers = { Authorization: `Bearer ${token ?? ""}`, "Content-Type": "application/json" };

  const { data: docs = [], isLoading } = useQuery<KnowledgeDoc[]>({
    queryKey: ["knowledge", activeBusinessId],
    queryFn: async () => {
      if (!activeBusinessId) return [];
      const resp = await fetch(`${apiBase}/knowledge?businessId=${activeBusinessId}`, { headers });
      return resp.ok ? resp.json() : [];
    },
    enabled: !!token && !!activeBusinessId,
    refetchInterval: 5000,
  });

  const { data: agents = [] } = useQuery<Agent[]>({
    queryKey: ["agents", activeBusinessId],
    queryFn: async () => {
      if (!activeBusinessId) return [];
      const resp = await fetch(`${apiBase}/agents?businessId=${activeBusinessId}`, { headers });
      return resp.ok ? resp.json() : [];
    },
    enabled: !!token && !!activeBusinessId,
  });

  const deleteDoc = useMutation({
    mutationFn: async (id: string) => {
      const resp = await fetch(`${apiBase}/knowledge/${id}`, { method: "DELETE", headers });
      if (!resp.ok) throw new Error("Delete failed");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["knowledge", activeBusinessId] });
    },
    onError: () => Alert.alert("Error", "Failed to delete document."),
  });

  const updateAgent = useMutation({
    mutationFn: async ({ id, agentId }: { id: string; agentId: string | null }) => {
      const resp = await fetch(`${apiBase}/knowledge/${id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ agentId }),
      });
      if (!resp.ok) throw new Error("Update failed");
      return resp.json() as Promise<KnowledgeDoc>;
    },
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ["knowledge", activeBusinessId] });
      setSelectedDoc(updated);
    },
    onError: () => Alert.alert("Error", "Failed to update document."),
  });

  const handleUploadFile = useCallback(async () => {
    setShowAddSheet(false);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "text/plain"],
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets?.[0]) return;

      const asset = result.assets[0]!;
      const title = asset.name?.replace(/\.[^/.]+$/, "") ?? "Uploaded Document";

      setUploading(true);

      const formData = new FormData();
      formData.append("businessId", activeBusinessId ?? "");
      formData.append("title", title);
      formData.append("file", {
        uri: asset.uri,
        name: asset.name ?? "document",
        type: asset.mimeType ?? "application/octet-stream",
      } as unknown as Blob);

      const resp = await fetch(`${apiBase}/knowledge`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token ?? ""}` },
        body: formData,
      });

      if (resp.ok) {
        queryClient.invalidateQueries({ queryKey: ["knowledge", activeBusinessId] });
      } else {
        Alert.alert("Error", "Failed to upload document.");
      }
    } catch (err) {
      Alert.alert("Error", "Failed to pick document.");
    } finally {
      setUploading(false);
    }
  }, [activeBusinessId, token]);

  const handlePasteText = useCallback(async () => {
    if (!pasteTitle.trim() || !pasteContent.trim()) {
      Alert.alert("Required", "Please enter a title and some content.");
      return;
    }

    setUploading(true);
    try {
      const resp = await fetch(`${apiBase}/knowledge`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          businessId: activeBusinessId,
          title: pasteTitle.trim(),
          content: pasteContent.trim(),
        }),
      });

      if (resp.ok) {
        setShowPasteModal(false);
        setPasteTitle("");
        setPasteContent("");
        queryClient.invalidateQueries({ queryKey: ["knowledge", activeBusinessId] });
      } else {
        Alert.alert("Error", "Failed to save document.");
      }
    } catch {
      Alert.alert("Error", "Network error. Please try again.");
    } finally {
      setUploading(false);
    }
  }, [pasteTitle, pasteContent, activeBusinessId, token]);

  const handleDeleteDoc = (doc: KnowledgeDoc) => {
    Alert.alert(
      "Delete Document",
      `Remove "${doc.title}" from the knowledge base? This cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => deleteDoc.mutate(doc.id),
        },
      ],
    );
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "ready": return "#22C55E";
      case "processing": return "#F59E0B";
      case "failed": return "#EF4444";
      default: return "#8A8A8A";
    }
  };

  const getScopeLabel = (doc: KnowledgeDoc) => {
    if (!doc.agentId) return "All agents";
    const agent = agents.find((a) => a.id === doc.agentId);
    return agent ? agent.name : "Specific agent";
  };

  const renderDoc = ({ item }: { item: KnowledgeDoc }) => (
    <TouchableOpacity
      style={styles.docCard}
      onPress={() => {
        setSelectedDoc(item);
        setShowDetailModal(true);
      }}
      onLongPress={() => handleDeleteDoc(item)}
      delayLongPress={500}
      activeOpacity={0.7}
    >
      <View style={styles.docIconWrap}>
        <Feather name="file-text" size={20} color={GOLD} />
      </View>
      <View style={styles.docInfo}>
        <Text style={styles.docTitle} numberOfLines={1}>{item.title}</Text>
        <View style={styles.docMeta}>
          <View style={[styles.statusDot, { backgroundColor: getStatusColor(item.status) }]} />
          <Text style={styles.docMetaText}>
            {item.status === "ready"
              ? `${item.chunkCount ?? 0} chunks`
              : item.status}
          </Text>
          <Text style={styles.docMetaDivider}>·</Text>
          <Text style={styles.docMetaText}>
            {new Date(item.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
          </Text>
          <Text style={styles.docMetaDivider}>·</Text>
          <Text style={styles.docMetaText}>{getScopeLabel(item)}</Text>
        </View>
      </View>
      <TouchableOpacity
        style={styles.docDelete}
        onPress={() => handleDeleteDoc(item)}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      >
        <Feather name="trash-2" size={16} color="#555" />
      </TouchableOpacity>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="arrow-left" size={22} color="#FFFFFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Knowledge Base</Text>
        <TouchableOpacity
          style={styles.addBtn}
          onPress={() => setShowAddSheet(true)}
          disabled={uploading}
        >
          {uploading ? (
            <ActivityIndicator size="small" color={GOLD} />
          ) : (
            <Feather name="plus" size={22} color={GOLD} />
          )}
        </TouchableOpacity>
      </View>

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={GOLD} size="large" />
        </View>
      ) : docs.length === 0 ? (
        <View style={styles.centered}>
          <Feather name="book" size={48} color="#333" />
          <Text style={styles.emptyTitle}>No documents yet</Text>
          <Text style={styles.emptySubtext}>
            Upload PDFs, Word documents, or paste text to give your AI agents business-specific knowledge.
          </Text>
          <TouchableOpacity style={styles.emptyAddBtn} onPress={() => setShowAddSheet(true)}>
            <Feather name="plus" size={16} color="#0A0A0A" />
            <Text style={styles.emptyAddBtnText}>Add Document</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={docs}
          keyExtractor={(item) => item.id}
          renderItem={renderDoc}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* Add Sheet */}
      <Modal visible={showAddSheet} animationType="slide" presentationStyle="pageSheet" transparent>
        <TouchableOpacity style={styles.sheetOverlay} activeOpacity={1} onPress={() => setShowAddSheet(false)} />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>Add Document</Text>
          <TouchableOpacity style={styles.sheetOption} onPress={handleUploadFile}>
            <View style={styles.sheetOptionIcon}>
              <Feather name="upload" size={20} color={GOLD} />
            </View>
            <View style={styles.sheetOptionInfo}>
              <Text style={styles.sheetOptionLabel}>Upload File</Text>
              <Text style={styles.sheetOptionSub}>PDF, Word (.docx), or plain text</Text>
            </View>
            <Feather name="chevron-right" size={16} color="#555" />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.sheetOption}
            onPress={() => {
              setShowAddSheet(false);
              setShowPasteModal(true);
            }}
          >
            <View style={styles.sheetOptionIcon}>
              <Feather name="edit-3" size={20} color={GOLD} />
            </View>
            <View style={styles.sheetOptionInfo}>
              <Text style={styles.sheetOptionLabel}>Paste Text</Text>
              <Text style={styles.sheetOptionSub}>Type or paste content directly</Text>
            </View>
            <Feather name="chevron-right" size={16} color="#555" />
          </TouchableOpacity>
        </View>
      </Modal>

      {/* Paste Text Modal */}
      <Modal visible={showPasteModal} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={styles.modal}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Paste Text</Text>
            <TouchableOpacity onPress={() => setShowPasteModal(false)}>
              <Feather name="x" size={22} color="#FFFFFF" />
            </TouchableOpacity>
          </View>
          <ScrollView style={styles.modalContent} keyboardShouldPersistTaps="handled">
            <Text style={styles.fieldLabel}>Document Title</Text>
            <TextInput
              style={styles.textInput}
              value={pasteTitle}
              onChangeText={setPasteTitle}
              placeholder="e.g. Company Pricing Policy"
              placeholderTextColor="#555"
              autoFocus
            />
            <Text style={styles.fieldLabel}>Content</Text>
            <TextInput
              style={[styles.textInput, styles.textAreaInput]}
              value={pasteContent}
              onChangeText={setPasteContent}
              placeholder="Paste your document content here..."
              placeholderTextColor="#555"
              multiline
              numberOfLines={12}
              textAlignVertical="top"
            />
          </ScrollView>
          <View style={styles.modalFooter}>
            <TouchableOpacity
              style={[styles.saveBtn, (!pasteTitle.trim() || !pasteContent.trim() || uploading) && styles.saveBtnDisabled]}
              onPress={handlePasteText}
              disabled={!pasteTitle.trim() || !pasteContent.trim() || uploading}
            >
              {uploading ? (
                <ActivityIndicator color="#0A0A0A" />
              ) : (
                <Text style={styles.saveBtnText}>Save Document</Text>
              )}
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </Modal>

      {/* Document Detail Modal */}
      <Modal visible={showDetailModal} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={styles.modal}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle} numberOfLines={1}>{selectedDoc?.title ?? "Document"}</Text>
            <TouchableOpacity onPress={() => setShowDetailModal(false)}>
              <Feather name="x" size={22} color="#FFFFFF" />
            </TouchableOpacity>
          </View>
          <ScrollView style={styles.modalContent}>
            {selectedDoc && (
              <>
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Status</Text>
                  <View style={styles.detailValue}>
                    <View style={[styles.statusDot, { backgroundColor: getStatusColor(selectedDoc.status) }]} />
                    <Text style={styles.detailValueText}>{selectedDoc.status}</Text>
                  </View>
                </View>
                {selectedDoc.chunkCount != null && (
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Chunks</Text>
                    <Text style={styles.detailValueText}>{selectedDoc.chunkCount}</Text>
                  </View>
                )}
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Added</Text>
                  <Text style={styles.detailValueText}>
                    {new Date(selectedDoc.createdAt).toLocaleDateString("en-GB", {
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                    })}
                  </Text>
                </View>

                <Text style={[styles.fieldLabel, { marginTop: 24 }]}>Scope</Text>
                <Text style={styles.scopeHint}>
                  Choose which agents can access this document. "All agents" makes it available to every AI agent in your business.
                </Text>

                <TouchableOpacity
                  style={[styles.scopeOption, !selectedDoc.agentId && styles.scopeOptionActive]}
                  onPress={() => updateAgent.mutate({ id: selectedDoc.id, agentId: null })}
                >
                  <View style={styles.scopeOptionContent}>
                    <Feather name="users" size={16} color={!selectedDoc.agentId ? GOLD : "#555"} />
                    <Text style={[styles.scopeOptionText, !selectedDoc.agentId && styles.scopeOptionTextActive]}>
                      All agents
                    </Text>
                  </View>
                  {!selectedDoc.agentId && <Feather name="check" size={16} color={GOLD} />}
                </TouchableOpacity>

                {agents.map((agent) => (
                  <TouchableOpacity
                    key={agent.id}
                    style={[styles.scopeOption, selectedDoc.agentId === agent.id && styles.scopeOptionActive]}
                    onPress={() => updateAgent.mutate({ id: selectedDoc.id, agentId: agent.id })}
                  >
                    <View style={styles.scopeOptionContent}>
                      <Feather name="cpu" size={16} color={selectedDoc.agentId === agent.id ? GOLD : "#555"} />
                      <Text style={[styles.scopeOptionText, selectedDoc.agentId === agent.id && styles.scopeOptionTextActive]}>
                        {agent.name}
                      </Text>
                    </View>
                    {selectedDoc.agentId === agent.id && <Feather name="check" size={16} color={GOLD} />}
                  </TouchableOpacity>
                ))}

                {updateAgent.isPending && (
                  <ActivityIndicator color={GOLD} style={{ marginTop: 16 }} />
                )}
              </>
            )}
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0A0A0A" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomColor: "#1A1A1A",
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { padding: 4 },
  headerTitle: {
    flex: 1,
    fontSize: 20,
    fontFamily: "Inter_700Bold",
    color: "#FFFFFF",
    marginLeft: 12,
    letterSpacing: -0.3,
  },
  addBtn: { padding: 4 },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 40,
  },
  emptyTitle: {
    fontSize: 18,
    fontFamily: "Inter_700Bold",
    color: "#FFFFFF",
    marginTop: 16,
    marginBottom: 8,
  },
  emptySubtext: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: "#555",
    textAlign: "center",
    lineHeight: 20,
    marginBottom: 24,
  },
  emptyAddBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: GOLD,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 24,
  },
  emptyAddBtnText: { fontSize: 15, fontFamily: "Inter_700Bold", color: "#0A0A0A" },
  listContent: { padding: 16, gap: 10 },
  docCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1A1A1A",
    borderColor: "#2A2A2A",
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    gap: 12,
  },
  docIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.goldMuted,
    justifyContent: "center",
    alignItems: "center",
  },
  docInfo: { flex: 1 },
  docTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#FFFFFF", marginBottom: 4 },
  docMeta: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 4 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  docMetaText: { fontSize: 12, fontFamily: "Inter_400Regular", color: "#8A8A8A" },
  docMetaDivider: { fontSize: 12, color: "#444" },
  docDelete: { padding: 4 },
  sheetOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)" },
  sheet: {
    backgroundColor: "#1A1A1A",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 40,
    gap: 4,
  },
  sheetHandle: {
    width: 40,
    height: 4,
    backgroundColor: "#333",
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: 16,
  },
  sheetTitle: {
    fontSize: 18,
    fontFamily: "Inter_700Bold",
    color: "#FFFFFF",
    marginBottom: 16,
  },
  sheetOption: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    padding: 14,
    backgroundColor: "#121212",
    borderColor: "#2A2A2A",
    borderWidth: 1,
    borderRadius: 14,
    marginBottom: 8,
  },
  sheetOptionIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.goldMuted,
    justifyContent: "center",
    alignItems: "center",
  },
  sheetOptionInfo: { flex: 1 },
  sheetOptionLabel: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#FFFFFF" },
  sheetOptionSub: { fontSize: 12, fontFamily: "Inter_400Regular", color: "#8A8A8A", marginTop: 2 },
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
  modalTitle: { fontSize: 18, fontFamily: "Inter_700Bold", color: "#FFFFFF", flex: 1, marginRight: 12 },
  modalContent: { flex: 1, padding: 20 },
  fieldLabel: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    color: "#8A8A8A",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 10,
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
  textAreaInput: { minHeight: 180 },
  modalFooter: { padding: 20, borderTopColor: "#2A2A2A", borderTopWidth: StyleSheet.hairlineWidth },
  saveBtn: {
    backgroundColor: GOLD,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: "center",
  },
  saveBtnDisabled: { opacity: 0.4 },
  saveBtnText: { fontSize: 16, fontFamily: "Inter_700Bold", color: "#0A0A0A" },
  detailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomColor: "#1A1A1A",
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  detailLabel: { fontSize: 14, fontFamily: "Inter_400Regular", color: "#8A8A8A" },
  detailValue: { flexDirection: "row", alignItems: "center", gap: 6 },
  detailValueText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#FFFFFF" },
  scopeHint: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: "#555",
    marginBottom: 12,
    lineHeight: 18,
  },
  scopeOption: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 14,
    backgroundColor: "#1A1A1A",
    borderColor: "#2A2A2A",
    borderWidth: 1,
    borderRadius: 12,
    marginBottom: 8,
  },
  scopeOptionActive: { borderColor: GOLD, backgroundColor: Colors.goldMuted },
  scopeOptionContent: { flexDirection: "row", alignItems: "center", gap: 10 },
  scopeOptionText: { fontSize: 14, fontFamily: "Inter_500Medium", color: "#8A8A8A" },
  scopeOptionTextActive: { color: GOLD },
});
