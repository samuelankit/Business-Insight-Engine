import React, { useState, useRef, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import * as DocumentPicker from "expo-document-picker";
import Colors from "@/constants/colors";
import { useApp } from "@/context/AppContext";

const GOLD = Colors.gold;

type Step = "role" | "source" | "type-jd" | "ai-generate" | "gorigo-pick" | "upload" | "review";
type JDSource = "type" | "ai" | "gorigo" | "upload";

interface JDTemplate {
  id: string;
  roleTitle: string;
  description: string;
  jobDescription: string;
}

export default function CreateAgentScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { token, activeBusinessId } = useApp();
  const params = useLocalSearchParams<{ templateName?: string; templatePrompt?: string }>();

  const apiBase = `https://${process.env["EXPO_PUBLIC_DOMAIN"]}/api`;
  const authHeaders = { Authorization: `Bearer ${token ?? ""}` };

  const [step, setStep] = useState<Step>("role");
  const [roleTitle, setRoleTitle] = useState(params.templateName ?? "");
  const [jobDescription, setJobDescription] = useState(params.templatePrompt ?? "");
  const [agentName, setAgentName] = useState(params.templateName ?? "");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [aiContext, setAiContext] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [streamedJD, setStreamedJD] = useState("");

  const [jdTemplates, setJdTemplates] = useState<JDTemplate[]>([]);
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(false);

  const [isUploading, setIsUploading] = useState(false);
  const [uploadedFileName, setUploadedFileName] = useState("");

  const jdTextRef = useRef(jobDescription);

  useEffect(() => {
    if (params.templateName && params.templatePrompt) {
      setStep("review");
    }
  }, []);

  const goBack = () => {
    if (step === "role") {
      router.back();
    } else if (step === "source") {
      setStep("role");
    } else if (step === "type-jd" || step === "ai-generate" || step === "gorigo-pick" || step === "upload") {
      setStep("source");
    } else if (step === "review") {
      setStep("source");
    }
  };

  const handleRoleNext = () => {
    if (!roleTitle.trim()) {
      Alert.alert("Role Title Required", "Please enter a role or job title.");
      return;
    }
    if (!agentName.trim()) {
      setAgentName(roleTitle.trim());
    }
    setStep("source");
  };

  const handleSourcePick = (source: JDSource) => {
    if (source === "type") {
      setStep("type-jd");
    } else if (source === "ai") {
      setStreamedJD("");
      setAiContext("");
      setStep("ai-generate");
    } else if (source === "gorigo") {
      loadJDTemplates();
      setStep("gorigo-pick");
    } else if (source === "upload") {
      setStep("upload");
    }
  };

  const [jdTemplateError, setJdTemplateError] = useState<string | null>(null);

  const loadJDTemplates = async () => {
    setIsLoadingTemplates(true);
    setJdTemplateError(null);
    try {
      const resp = await fetch(`${apiBase}/agents/jd-templates`, {
        headers: { ...authHeaders },
      });
      if (resp.ok) {
        const data = await resp.json();
        setJdTemplates(data);
      } else {
        setJdTemplateError("Could not load templates. Please try again.");
      }
    } catch {
      setJdTemplateError("Network error — could not load templates.");
    } finally {
      setIsLoadingTemplates(false);
    }
  };

  const handleGenerateAI = async () => {
    if (!roleTitle.trim()) return;
    setIsGenerating(true);
    setStreamedJD("");

    try {
      const resp = await fetch(`${apiBase}/agents/generate-jd`, {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ roleTitle, context: aiContext }),
      });

      if (!resp.ok) {
        throw new Error("Failed to generate JD");
      }

      const reader = resp.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let fullText = "";

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (line.startsWith("event: token")) continue;
            if (line.startsWith("data: ")) {
              try {
                const parsed = JSON.parse(line.slice(6));
                if (parsed.token) {
                  fullText += parsed.token;
                  setStreamedJD(fullText);
                } else if (parsed.text) {
                  fullText = parsed.text;
                  setStreamedJD(fullText);
                }
              } catch {}
            }
          }
        }
      }
    } catch (err) {
      Alert.alert("Generation Failed", "Could not generate a Job Description. Please try again or type it manually.");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleConfirmAI = () => {
    setJobDescription(streamedJD);
    setStep("review");
  };

  const handlePickGoRigoTemplate = (template: JDTemplate) => {
    setJobDescription(template.jobDescription);
    if (!agentName.trim() || agentName === roleTitle) {
      setAgentName(template.roleTitle);
    }
    setStep("review");
  };

  const handleUploadDocument = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: [
          "application/pdf",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          "application/msword",
          "text/plain",
        ],
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets?.length) return;

      const asset = result.assets[0]!;
      setUploadedFileName(asset.name);
      setIsUploading(true);

      const formData = new FormData();
      formData.append("file", {
        uri: asset.uri,
        name: asset.name,
        type: asset.mimeType ?? "application/octet-stream",
      } as unknown as Blob);

      const resp = await fetch(`${apiBase}/agents/parse-jd`, {
        method: "POST",
        headers: { ...authHeaders },
        body: formData,
      });

      if (!resp.ok) {
        const err = await resp.json();
        throw new Error(err.error ?? "Upload failed");
      }

      const { jobDescription: parsed } = await resp.json();
      setJobDescription(parsed);
      setStep("review");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      Alert.alert("Upload Failed", msg);
    } finally {
      setIsUploading(false);
    }
  };

  const handleCreateAgent = async () => {
    if (!agentName.trim()) {
      Alert.alert("Agent Name Required", "Please enter a name for this agent.");
      return;
    }
    if (!jobDescription.trim()) {
      Alert.alert("Job Description Required", "Please provide a Job Description.");
      return;
    }
    if (!activeBusinessId) {
      Alert.alert("No Business Selected", "Please select a business first.");
      return;
    }

    setIsSubmitting(true);
    try {
      const resp = await fetch(`${apiBase}/agents`, {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({
          businessId: activeBusinessId,
          name: agentName.trim(),
          jobDescription: jobDescription.trim(),
        }),
      });

      if (!resp.ok) {
        const err = await resp.json();
        throw new Error(err.error ?? "Failed to create agent");
      }

      queryClient.invalidateQueries({ queryKey: ["agents"] });
      router.back();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      Alert.alert("Creation Failed", msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const stepIndex = { role: 1, source: 2, "type-jd": 3, "ai-generate": 3, "gorigo-pick": 3, upload: 3, review: 4 }[step];
  const totalSteps = 4;

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.topBar}>
          <TouchableOpacity onPress={goBack} style={styles.backBtn}>
            <Feather name="arrow-left" size={22} color="#FFFFFF" />
          </TouchableOpacity>
          <View style={styles.progressContainer}>
            {Array.from({ length: totalSteps }).map((_, i) => (
              <View
                key={i}
                style={[styles.progressDot, i + 1 <= stepIndex ? styles.progressDotActive : styles.progressDotInactive]}
              />
            ))}
          </View>
          <View style={styles.backBtn} />
        </View>

        {step === "role" && (
          <ScrollView style={styles.content} contentContainerStyle={styles.contentPad} keyboardShouldPersistTaps="handled">
            <Text style={styles.stepLabel}>Step 1 of 4</Text>
            <Text style={styles.stepTitle}>What role does this agent fill?</Text>
            <Text style={styles.stepSubtitle}>
              Enter the job title or role name. This helps the agent understand its purpose.
            </Text>
            <TextInput
              style={styles.textInput}
              value={roleTitle}
              onChangeText={setRoleTitle}
              placeholder="e.g. Marketing Manager"
              placeholderTextColor="#555"
              autoFocus
              returnKeyType="next"
              onSubmitEditing={handleRoleNext}
            />
          </ScrollView>
        )}

        {step === "source" && (
          <ScrollView style={styles.content} contentContainerStyle={styles.contentPad}>
            <Text style={styles.stepLabel}>Step 2 of 4</Text>
            <Text style={styles.stepTitle}>How would you like to define this role?</Text>
            <Text style={styles.stepSubtitle}>
              Choose how you want to provide the Job Description for "{roleTitle}".
            </Text>

            <TouchableOpacity style={styles.sourceCard} onPress={() => handleSourcePick("type")} activeOpacity={0.8}>
              <View style={[styles.sourceIcon, { backgroundColor: "rgba(245,166,35,0.15)" }]}>
                <Feather name="edit-3" size={22} color={GOLD} />
              </View>
              <View style={styles.sourceInfo}>
                <Text style={styles.sourceTitle}>Type it</Text>
                <Text style={styles.sourceDesc}>Write or paste your own Job Description</Text>
              </View>
              <Feather name="chevron-right" size={18} color="#555" />
            </TouchableOpacity>

            <TouchableOpacity style={styles.sourceCard} onPress={() => handleSourcePick("ai")} activeOpacity={0.8}>
              <View style={[styles.sourceIcon, { backgroundColor: "rgba(59,130,246,0.15)" }]}>
                <Feather name="zap" size={22} color="#3B82F6" />
              </View>
              <View style={styles.sourceInfo}>
                <Text style={styles.sourceTitle}>Generate with AI</Text>
                <Text style={styles.sourceDesc}>Let AI write a complete JD for you in real time</Text>
              </View>
              <Feather name="chevron-right" size={18} color="#555" />
            </TouchableOpacity>

            <TouchableOpacity style={styles.sourceCard} onPress={() => handleSourcePick("gorigo")} activeOpacity={0.8}>
              <View style={[styles.sourceIcon, { backgroundColor: "rgba(34,197,94,0.15)" }]}>
                <Feather name="star" size={22} color="#22C55E" />
              </View>
              <View style={styles.sourceInfo}>
                <Text style={styles.sourceTitle}>GoRigo Recommendation</Text>
                <Text style={styles.sourceDesc}>Pick from curated role templates with pre-written JDs</Text>
              </View>
              <Feather name="chevron-right" size={18} color="#555" />
            </TouchableOpacity>

            <TouchableOpacity style={styles.sourceCard} onPress={() => handleSourcePick("upload")} activeOpacity={0.8}>
              <View style={[styles.sourceIcon, { backgroundColor: "rgba(167,139,250,0.15)" }]}>
                <Feather name="upload" size={22} color="#A78BFA" />
              </View>
              <View style={styles.sourceInfo}>
                <Text style={styles.sourceTitle}>Upload a document</Text>
                <Text style={styles.sourceDesc}>Upload a PDF, DOCX, or TXT file and we'll extract the JD</Text>
              </View>
              <Feather name="chevron-right" size={18} color="#555" />
            </TouchableOpacity>
          </ScrollView>
        )}

        {step === "type-jd" && (
          <ScrollView style={styles.content} contentContainerStyle={styles.contentPad} keyboardShouldPersistTaps="handled">
            <Text style={styles.stepLabel}>Step 3 of 4</Text>
            <Text style={styles.stepTitle}>Write your Job Description</Text>
            <Text style={styles.stepSubtitle}>
              Describe the role's responsibilities, goals, and expectations.
            </Text>
            <TextInput
              style={[styles.textInput, styles.textInputTall]}
              value={jobDescription}
              onChangeText={setJobDescription}
              placeholder={`Job Description for ${roleTitle}...\n\nResponsibilities:\n- \n\nKPIs:\n- \n\nSkills Required:\n- `}
              placeholderTextColor="#555"
              multiline
              autoFocus
              textAlignVertical="top"
            />
          </ScrollView>
        )}

        {step === "ai-generate" && (
          <ScrollView style={styles.content} contentContainerStyle={styles.contentPad} keyboardShouldPersistTaps="handled">
            <Text style={styles.stepLabel}>Step 3 of 4</Text>
            <Text style={styles.stepTitle}>Generate with AI</Text>
            <Text style={styles.stepSubtitle}>
              Add some context (optional) to make the JD more specific, then tap Generate.
            </Text>
            <TextInput
              style={[styles.textInput, { height: 90 }]}
              value={aiContext}
              onChangeText={setAiContext}
              placeholder="e.g. B2B SaaS startup, remote team, must have experience with HubSpot..."
              placeholderTextColor="#555"
              multiline
              textAlignVertical="top"
            />
            {!isGenerating && !streamedJD && (
              <TouchableOpacity style={styles.generateBtn} onPress={handleGenerateAI} activeOpacity={0.85}>
                <Feather name="zap" size={16} color="#0A0A0A" style={{ marginRight: 8 }} />
                <Text style={styles.generateBtnText}>Generate Job Description</Text>
              </TouchableOpacity>
            )}
            {isGenerating && (
              <View style={styles.generatingContainer}>
                <ActivityIndicator color={GOLD} />
                <Text style={styles.generatingText}>Writing your JD...</Text>
              </View>
            )}
            {streamedJD ? (
              <>
                <Text style={styles.fieldLabel}>Generated JD — Edit if needed</Text>
                <TextInput
                  style={[styles.textInput, styles.textInputTall]}
                  value={streamedJD}
                  onChangeText={setStreamedJD}
                  multiline
                  textAlignVertical="top"
                />
                <TouchableOpacity style={styles.outlineBtn} onPress={handleGenerateAI} activeOpacity={0.8}>
                  <Feather name="refresh-cw" size={14} color={GOLD} style={{ marginRight: 6 }} />
                  <Text style={styles.outlineBtnText}>Regenerate</Text>
                </TouchableOpacity>
              </>
            ) : null}
          </ScrollView>
        )}

        {step === "gorigo-pick" && (
          <ScrollView style={styles.content} contentContainerStyle={styles.contentPad}>
            <Text style={styles.stepLabel}>Step 3 of 4</Text>
            <Text style={styles.stepTitle}>GoRigo Role Templates</Text>
            <Text style={styles.stepSubtitle}>
              Select a curated role to use its pre-written Job Description.
            </Text>
            {isLoadingTemplates ? (
              <View style={styles.centeredLoader}>
                <ActivityIndicator color={GOLD} />
                <Text style={styles.generatingText}>Loading templates...</Text>
              </View>
            ) : jdTemplateError ? (
              <View style={styles.centeredLoader}>
                <Feather name="alert-circle" size={32} color="#555" />
                <Text style={styles.generatingText}>{jdTemplateError}</Text>
                <TouchableOpacity style={styles.outlineBtn} onPress={loadJDTemplates} activeOpacity={0.8}>
                  <Text style={styles.outlineBtnText}>Try Again</Text>
                </TouchableOpacity>
              </View>
            ) : (
              jdTemplates.map((t) => (
                <TouchableOpacity
                  key={t.id}
                  style={styles.templatePickCard}
                  onPress={() => handlePickGoRigoTemplate(t)}
                  activeOpacity={0.8}
                >
                  <View style={styles.templatePickIcon}>
                    <Feather name="briefcase" size={18} color={GOLD} />
                  </View>
                  <View style={styles.templatePickInfo}>
                    <Text style={styles.templatePickTitle}>{t.roleTitle}</Text>
                    <Text style={styles.templatePickDesc}>{t.description}</Text>
                  </View>
                  <Feather name="chevron-right" size={16} color="#555" />
                </TouchableOpacity>
              ))
            )}
          </ScrollView>
        )}

        {step === "upload" && (
          <ScrollView style={styles.content} contentContainerStyle={styles.contentPad}>
            <Text style={styles.stepLabel}>Step 3 of 4</Text>
            <Text style={styles.stepTitle}>Upload a Document</Text>
            <Text style={styles.stepSubtitle}>
              Select a PDF, DOCX, or TXT file from your device. We'll extract and summarise the Job Description for you.
            </Text>

            {isUploading ? (
              <View style={styles.centeredLoader}>
                <ActivityIndicator color={GOLD} size="large" />
                <Text style={styles.generatingText}>Processing "{uploadedFileName}"...</Text>
                <Text style={styles.stepSubtitle}>This may take a moment</Text>
              </View>
            ) : (
              <TouchableOpacity style={styles.uploadZone} onPress={handleUploadDocument} activeOpacity={0.8}>
                <Feather name="file-text" size={40} color="#555" />
                <Text style={styles.uploadZoneTitle}>Tap to choose a file</Text>
                <Text style={styles.uploadZoneDesc}>PDF, DOCX, or TXT • Max 10 MB</Text>
              </TouchableOpacity>
            )}
          </ScrollView>
        )}

        {step === "review" && (
          <ScrollView style={styles.content} contentContainerStyle={styles.contentPad} keyboardShouldPersistTaps="handled">
            <Text style={styles.stepLabel}>Step 4 of 4</Text>
            <Text style={styles.stepTitle}>Review & Create</Text>
            <Text style={styles.stepSubtitle}>
              Review your Job Description and set a name for the agent.
            </Text>

            <Text style={styles.fieldLabel}>Agent Name</Text>
            <TextInput
              style={styles.textInput}
              value={agentName}
              onChangeText={setAgentName}
              placeholder={roleTitle || "e.g. Marketing Manager"}
              placeholderTextColor="#555"
            />

            <Text style={styles.fieldLabel}>Job Description</Text>
            <TextInput
              style={[styles.textInput, styles.textInputTall]}
              value={jobDescription}
              onChangeText={setJobDescription}
              multiline
              textAlignVertical="top"
              placeholder="Your job description will appear here..."
              placeholderTextColor="#555"
            />
          </ScrollView>
        )}

        <View style={styles.footer}>
          {step === "role" && (
            <TouchableOpacity
              style={[styles.primaryBtn, !roleTitle.trim() && styles.primaryBtnDisabled]}
              onPress={handleRoleNext}
              disabled={!roleTitle.trim()}
              activeOpacity={0.85}
            >
              <Text style={styles.primaryBtnText}>Continue</Text>
              <Feather name="arrow-right" size={16} color="#0A0A0A" style={{ marginLeft: 6 }} />
            </TouchableOpacity>
          )}

          {step === "type-jd" && (
            <TouchableOpacity
              style={[styles.primaryBtn, !jobDescription.trim() && styles.primaryBtnDisabled]}
              onPress={() => setStep("review")}
              disabled={!jobDescription.trim()}
              activeOpacity={0.85}
            >
              <Text style={styles.primaryBtnText}>Continue to Review</Text>
              <Feather name="arrow-right" size={16} color="#0A0A0A" style={{ marginLeft: 6 }} />
            </TouchableOpacity>
          )}

          {step === "ai-generate" && streamedJD ? (
            <TouchableOpacity
              style={[styles.primaryBtn, !streamedJD.trim() && styles.primaryBtnDisabled]}
              onPress={handleConfirmAI}
              disabled={!streamedJD.trim()}
              activeOpacity={0.85}
            >
              <Text style={styles.primaryBtnText}>Use This JD</Text>
              <Feather name="check" size={16} color="#0A0A0A" style={{ marginLeft: 6 }} />
            </TouchableOpacity>
          ) : null}

          {step === "review" && (
            <TouchableOpacity
              style={[styles.primaryBtn, (!agentName.trim() || !jobDescription.trim() || isSubmitting) && styles.primaryBtnDisabled]}
              onPress={handleCreateAgent}
              disabled={!agentName.trim() || !jobDescription.trim() || isSubmitting}
              activeOpacity={0.85}
            >
              {isSubmitting ? (
                <ActivityIndicator color="#0A0A0A" size="small" />
              ) : (
                <>
                  <Feather name="cpu" size={16} color="#0A0A0A" style={{ marginRight: 6 }} />
                  <Text style={styles.primaryBtnText}>Create Agent</Text>
                </>
              )}
            </TouchableOpacity>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0A0A0A" },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomColor: "#2A2A2A",
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: {
    width: 40,
    height: 40,
    justifyContent: "center",
    alignItems: "center",
  },
  progressContainer: {
    flexDirection: "row",
    gap: 6,
  },
  progressDot: {
    width: 28,
    height: 4,
    borderRadius: 2,
  },
  progressDotActive: { backgroundColor: GOLD },
  progressDotInactive: { backgroundColor: "#2A2A2A" },
  content: { flex: 1 },
  contentPad: { padding: 24, paddingBottom: 40 },
  stepLabel: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    color: GOLD,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 8,
  },
  stepTitle: {
    fontSize: 24,
    fontFamily: "Inter_700Bold",
    color: "#FFFFFF",
    marginBottom: 8,
    lineHeight: 30,
  },
  stepSubtitle: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: "#8A8A8A",
    marginBottom: 28,
    lineHeight: 20,
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
    marginBottom: 16,
  },
  textInputTall: { height: 260 },
  fieldLabel: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    color: "#8A8A8A",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  sourceCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1A1A1A",
    borderColor: "#2A2A2A",
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    gap: 14,
  },
  sourceIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: "center",
    alignItems: "center",
  },
  sourceInfo: { flex: 1 },
  sourceTitle: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
    color: "#FFFFFF",
    marginBottom: 3,
  },
  sourceDesc: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: "#8A8A8A",
    lineHeight: 18,
  },
  generateBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: GOLD,
    borderRadius: 12,
    paddingVertical: 14,
    marginBottom: 16,
  },
  generateBtnText: {
    fontSize: 15,
    fontFamily: "Inter_700Bold",
    color: "#0A0A0A",
  },
  outlineBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderColor: GOLD,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 10,
    marginBottom: 12,
  },
  outlineBtnText: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    color: GOLD,
  },
  generatingContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 20,
  },
  generatingText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: "#8A8A8A",
  },
  centeredLoader: {
    alignItems: "center",
    paddingVertical: 60,
    gap: 12,
  },
  templatePickCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1A1A1A",
    borderColor: "#2A2A2A",
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    gap: 12,
  },
  templatePickIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: Colors.goldMuted,
    justifyContent: "center",
    alignItems: "center",
  },
  templatePickInfo: { flex: 1 },
  templatePickTitle: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    color: "#FFFFFF",
    marginBottom: 2,
  },
  templatePickDesc: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: "#8A8A8A",
  },
  uploadZone: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#1A1A1A",
    borderColor: "#2A2A2A",
    borderWidth: 1,
    borderRadius: 16,
    borderStyle: "dashed",
    paddingVertical: 60,
    gap: 12,
  },
  uploadZoneTitle: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
    color: "#FFFFFF",
  },
  uploadZoneDesc: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: "#8A8A8A",
  },
  footer: {
    padding: 20,
    borderTopColor: "#2A2A2A",
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: GOLD,
    borderRadius: 14,
    paddingVertical: 16,
  },
  primaryBtnDisabled: { opacity: 0.45 },
  primaryBtnText: {
    fontSize: 16,
    fontFamily: "Inter_700Bold",
    color: "#0A0A0A",
  },
});
