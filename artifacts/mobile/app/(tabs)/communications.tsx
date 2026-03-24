import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  Modal,
  Animated,
  Easing,
  Pressable,
  ActivityIndicator,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Audio } from "expo-av";
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

interface VoiceCall {
  id: string;
  agentId: string | null;
  agentName: string | null;
  direction: string;
  transcriptSummary: string | null;
  creditsUsed: string;
  createdAt: string;
}

interface VoicePrefs {
  inputLocale: string;
  outputLocale: string;
  voiceActivated: boolean;
  hasPinSet: boolean;
  walletBalancePence: number;
}

interface PhoneNumber {
  id: string;
  phoneNumber: string | null;
  agentId: string | null;
  monthlyFeePence: string;
  createdAt: string;
}

type Tab = "contacts" | "campaigns" | "voice";

const LOCALES = [
  { code: "en-GB", label: "English (UK)" },
  { code: "en-US", label: "English (US)" },
  { code: "en-NG", label: "English (Nigerian)" },
  { code: "en-IN", label: "English (Indian)" },
  { code: "cy", label: "Welsh" },
  { code: "fr", label: "French" },
  { code: "ar", label: "Arabic" },
  { code: "es", label: "Spanish" },
  { code: "de", label: "German" },
  { code: "zh", label: "Chinese (Mandarin)" },
];

const SUGGESTED_COMMANDS = [
  "How is my business doing?",
  "What should I focus on today?",
  "Who am I talking to?",
];

const VOICE_SESSION_KEY = "@gorigo/voice_session_token";
const VOICE_SESSION_EXPIRY_KEY = "@gorigo/voice_session_expiry";
const VOICE_INTRO_SHOWN_KEY = "@gorigo/voice_intro_shown";

export default function CommunicationsScreen() {
  const { token, activeBusinessId } = useApp();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<Tab>("contacts");

  const [showAddContact, setShowAddContact] = useState(false);
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [contactEmail, setContactEmail] = useState("");

  const [voiceSessionToken, setVoiceSessionToken] = useState<string | null>(null);
  const [showPinModal, setShowPinModal] = useState(false);
  const [pinMode, setPinMode] = useState<"setup" | "verify">("verify");
  const [pinInput, setPinInput] = useState("");
  const [pinLoading, setPinLoading] = useState(false);
  const [pinError, setPinError] = useState("");

  const [showPrefsModal, setShowPrefsModal] = useState(false);
  const [inputLocale, setInputLocale] = useState("en-GB");
  const [outputLocale, setOutputLocale] = useState("en-GB");
  const [localeLoading, setLocaleLoading] = useState(false);

  const [showNumbersModal, setShowNumbersModal] = useState(false);
  const [purchasingNumber, setPurchasingNumber] = useState(false);
  const [selectedVoiceAgentId, setSelectedVoiceAgentId] = useState<string | null>(null);
  const [assigningNumberId, setAssigningNumberId] = useState<string | null>(null);
  const [pendingHighRiskTranscript, setPendingHighRiskTranscript] = useState<string | null>(null);
  const [highRiskConfirmToken, setHighRiskConfirmToken] = useState<string | null>(null);

  const [voiceState, setVoiceState] = useState<"idle" | "recording" | "processing" | "speaking">("idle");
  const [liveTranscript, setLiveTranscript] = useState("");
  const [rigoResponse, setRigoResponse] = useState("");
  const [introShown, setIntroShown] = useState(true);
  const [showSuggestedCommands, setShowSuggestedCommands] = useState(false);
  const [processingDots, setProcessingDots] = useState("...");

  const waveAnim = useRef(new Animated.Value(1)).current;
  const waveAnim2 = useRef(new Animated.Value(1)).current;
  const waveAnim3 = useRef(new Animated.Value(1)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const waveAnimation = useRef<Animated.CompositeAnimation | null>(null);
  const recordingRef = useRef<Audio.Recording | null>(null);
  const soundRef = useRef<Audio.Sound | null>(null);

  const apiBase = `https://${process.env["EXPO_PUBLIC_DOMAIN"]}/api`;
  const headers = { Authorization: `Bearer ${token ?? ""}`, "Content-Type": "application/json" };
  const voiceHeaders = {
    ...headers,
    ...(voiceSessionToken ? { "x-voice-session": voiceSessionToken } : {}),
  };

  useEffect(() => {
    (async () => {
      const sessionToken = await AsyncStorage.getItem(VOICE_SESSION_KEY);
      const expiryStr = await AsyncStorage.getItem(VOICE_SESSION_EXPIRY_KEY);
      if (sessionToken && expiryStr) {
        const expiry = new Date(expiryStr);
        if (expiry > new Date()) {
          setVoiceSessionToken(sessionToken);
        }
      }
      const introShownVal = await AsyncStorage.getItem(VOICE_INTRO_SHOWN_KEY);
      setIntroShown(introShownVal === "true");
    })();
  }, []);

  const startWaveAnimation = useCallback(() => {
    const wave = (anim: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(anim, { toValue: 1.6, duration: 400, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
          Animated.timing(anim, { toValue: 0.6, duration: 400, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
          Animated.timing(anim, { toValue: 1, duration: 300, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
        ]),
      );

    waveAnimation.current = Animated.parallel([
      wave(waveAnim, 0),
      wave(waveAnim2, 150),
      wave(waveAnim3, 300),
    ]);
    waveAnimation.current.start();
  }, []);

  const stopWaveAnimation = useCallback(() => {
    waveAnimation.current?.stop();
    waveAnim.setValue(1);
    waveAnim2.setValue(1);
    waveAnim3.setValue(1);
  }, []);

  const startPulseAnimation = useCallback(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.15, duration: 600, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
      ]),
    ).start();
  }, []);

  const stopPulseAnimation = useCallback(() => {
    pulseAnim.stopAnimation();
    pulseAnim.setValue(1);
  }, []);

  useEffect(() => {
    if (voiceState === "speaking") {
      startWaveAnimation();
      stopPulseAnimation();
    } else if (voiceState === "recording") {
      startPulseAnimation();
      stopWaveAnimation();
    } else {
      stopWaveAnimation();
      stopPulseAnimation();
    }
    return () => {
      stopWaveAnimation();
      stopPulseAnimation();
    };
  }, [voiceState]);

  const { data: voicePrefs, refetch: refetchVoicePrefs } = useQuery<VoicePrefs>({
    queryKey: ["voice-preferences"],
    queryFn: async () => {
      const resp = await fetch(`${apiBase}/voice/voice-preferences`, { headers });
      if (!resp.ok) return { inputLocale: "en-GB", outputLocale: "en-GB", voiceActivated: false, hasPinSet: false, walletBalancePence: 0 };
      return resp.json();
    },
    enabled: !!token && activeTab === "voice",
  });

  const { data: voiceCalls, refetch: refetchCalls } = useQuery<{ calls: VoiceCall[] }>({
    queryKey: ["voice-calls", activeBusinessId],
    queryFn: async () => {
      if (!activeBusinessId) return { calls: [] };
      const resp = await fetch(`${apiBase}/voice/calls?businessId=${activeBusinessId}`, { headers });
      return resp.ok ? resp.json() : { calls: [] };
    },
    enabled: !!token && !!activeBusinessId && activeTab === "voice",
  });

  const { data: phoneNumbers, refetch: refetchNumbers } = useQuery<{ numbers: PhoneNumber[] }>({
    queryKey: ["voice-numbers", activeBusinessId],
    queryFn: async () => {
      if (!activeBusinessId) return { numbers: [] };
      const resp = await fetch(`${apiBase}/voice/numbers?businessId=${activeBusinessId}`, { headers });
      return resp.ok ? resp.json() : { numbers: [] };
    },
    enabled: !!token && !!activeBusinessId && activeTab === "voice",
  });

  const { data: agentsList = [] } = useQuery<{ id: string; name: string; type: string }[]>({
    queryKey: ["agents-voice", activeBusinessId],
    queryFn: async () => {
      if (!activeBusinessId) return [];
      const resp = await fetch(`${apiBase}/agents?businessId=${activeBusinessId}`, { headers });
      if (!resp.ok) return [];
      const data = await resp.json() as { agents?: { id: string; name: string; type: string }[] };
      return data.agents ?? [];
    },
    enabled: !!token && !!activeBusinessId && activeTab === "voice",
  });

  useEffect(() => {
    if (voicePrefs) {
      setInputLocale(voicePrefs.inputLocale);
      setOutputLocale(voicePrefs.outputLocale);
    }
  }, [voicePrefs]);

  const playIntroTTS = useCallback(async (sessionToken: string) => {
    const introText = "Hi, I'm Rigo, your GoRigo voice assistant. I'm connected to your business and agents. Hold the mic button and ask me anything.";
    try {
      const ttsHeaders = {
        Authorization: `Bearer ${token ?? ""}`,
        "Content-Type": "application/json",
        "x-voice-session": sessionToken,
      };
      const resp = await fetch(`${apiBase}/voice/tts`, {
        method: "POST",
        headers: ttsHeaders,
        body: JSON.stringify({ text: introText }),
      });
      if (resp.ok) {
        const arrayBuffer = await resp.arrayBuffer();
        const uint8 = new Uint8Array(arrayBuffer);
        let binary = "";
        for (let i = 0; i < uint8.byteLength; i++) {
          binary += String.fromCharCode(uint8[i]!);
        }
        const base64 = btoa(binary);
        await playAudioBase64(base64);
        return;
      }
    } catch {
    }
    setTimeout(() => setVoiceState("idle"), 5000);
  }, [token, apiBase]);

  useEffect(() => {
    if (activeTab === "voice" && voicePrefs && !introShown) {
      const timer = setTimeout(async () => {
        const introText = "Hi, I'm Rigo — your GoRigo voice assistant. I'm connected to your business and your agents. Hold the mic button and ask me anything.";
        setRigoResponse(introText);
        setVoiceState("speaking");
        setShowSuggestedCommands(true);
        await AsyncStorage.setItem(VOICE_INTRO_SHOWN_KEY, "true");
        setIntroShown(true);

        if (voiceSessionToken) {
          await playIntroTTS(voiceSessionToken);
        } else {
          try {
            if (Platform.OS === "web" && typeof window !== "undefined" && "speechSynthesis" in window) {
              const utterance = new window.SpeechSynthesisUtterance(introText);
              utterance.lang = "en-GB";
              utterance.rate = 0.95;
              utterance.onend = () => setVoiceState("idle");
              window.speechSynthesis.speak(utterance);
            } else {
              const introUrl = `${apiBase}/voice/intro-tts`;
              const { FileSystem } = await import("expo-file-system");
              const localUri = FileSystem.cacheDirectory + "rigo_intro.mp3";
              const dl = await FileSystem.downloadAsync(introUrl, localUri, {
                headers: { Authorization: `Bearer ${token ?? ""}` },
              });
              if (dl.status === 200) {
                await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true });
                const { sound } = await Audio.Sound.createAsync({ uri: localUri }, { shouldPlay: true });
                sound.setOnPlaybackStatusUpdate((status) => {
                  if (status.isLoaded && status.didJustFinish) {
                    setVoiceState("idle");
                    sound.unloadAsync().catch(() => {});
                  }
                });
              } else {
                setTimeout(() => setVoiceState("idle"), 5000);
              }
            }
          } catch {
            setTimeout(() => setVoiceState("idle"), 5000);
          }
        }
      }, 800);
      return () => clearTimeout(timer);
    }
  }, [activeTab, voicePrefs, introShown]);

  useEffect(() => {
    if (voiceState !== "processing") return;
    const frames = [".", "..", "...", "...."];
    let i = 0;
    const timer = setInterval(() => {
      i = (i + 1) % frames.length;
      setProcessingDots(frames[i] ?? ".");
    }, 350);
    return () => clearInterval(timer);
  }, [voiceState]);

  const saveVoiceSession = async (sessionToken: string, expiresAt: string) => {
    setVoiceSessionToken(sessionToken);
    await AsyncStorage.setItem(VOICE_SESSION_KEY, sessionToken);
    await AsyncStorage.setItem(VOICE_SESSION_EXPIRY_KEY, expiresAt);
  };

  const handleSetPin = async () => {
    if (pinInput.length !== 4) {
      setPinError("PIN must be exactly 4 digits");
      return;
    }
    setPinLoading(true);
    setPinError("");
    try {
      const resp = await fetch(`${apiBase}/voice/pin/set`, {
        method: "POST",
        headers,
        body: JSON.stringify({ pin: pinInput }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setPinError(data.error ?? "Failed to set PIN");
        return;
      }
      if (data.firstActivation) {
        Alert.alert("Voice Activated!", `You've received ${Math.round(data.creditedPence / 8)} free voice credits to get started!`);
      }
      refetchVoicePrefs();
      setShowPinModal(false);
      setPinInput("");
      setPinMode("verify");
      handleVerifyPin(pinInput);
    } catch {
      setPinError("Connection error. Please try again.");
    } finally {
      setPinLoading(false);
    }
  };

  const handleVerifyPin = async (pin?: string) => {
    const pinToVerify = pin ?? pinInput;
    if (pinToVerify.length !== 4) {
      setPinError("PIN must be exactly 4 digits");
      return;
    }
    setPinLoading(true);
    setPinError("");
    try {
      const resp = await fetch(`${apiBase}/voice/pin/verify`, {
        method: "POST",
        headers,
        body: JSON.stringify({ pin: pinToVerify }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setPinError(data.error ?? "Incorrect PIN");
        return;
      }
      await saveVoiceSession(data.sessionToken, data.expiresAt);
      setShowPinModal(false);
      setPinInput("");
      if (pendingHighRiskTranscript && data.highRiskConfirmToken) {
        const pending = pendingHighRiskTranscript;
        const confirmTok = data.highRiskConfirmToken as string;
        setPendingHighRiskTranscript(null);
        setHighRiskConfirmToken(confirmTok);
        setTimeout(() => sendVoiceMessage(null, pending, true, confirmTok), 300);
      }
    } catch {
      setPinError("Connection error. Please try again.");
    } finally {
      setPinLoading(false);
    }
  };

  const openPinModal = (mode: "setup" | "verify") => {
    setPinMode(mode);
    setPinInput("");
    setPinError("");
    setShowPinModal(true);
  };

  const startRecording = async (): Promise<boolean> => {
    try {
      if (Platform.OS !== "web") {
        const { granted } = await Audio.requestPermissionsAsync();
        if (!granted) {
          Alert.alert("Microphone Permission", "Please grant microphone access to use Rigo voice.");
          return false;
        }
        await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      }

      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY,
      );
      recordingRef.current = recording;
      return true;
    } catch (err) {
      console.warn("Recording start error:", err);
      return false;
    }
  };

  const stopRecordingAndGetBase64 = async (): Promise<string | null> => {
    const recording = recordingRef.current;
    if (!recording) return null;

    try {
      await recording.stopAndUnloadAsync();
      recordingRef.current = null;

      if (Platform.OS === "web") {
        return null;
      }

      const uri = recording.getURI();
      if (!uri) return null;

      const { FileSystem } = await import("expo-file-system");
      const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
      return base64;
    } catch (err) {
      console.warn("Recording stop error:", err);
      recordingRef.current = null;
      return null;
    }
  };

  const playAudioBase64 = async (base64Audio: string) => {
    try {
      if (soundRef.current) {
        await soundRef.current.unloadAsync();
        soundRef.current = null;
      }

      if (Platform.OS === "web") {
        const audioData = `data:audio/mpeg;base64,${base64Audio}`;
        const audio = new window.Audio(audioData);
        audio.onended = () => setVoiceState("idle");
        await audio.play();
        return;
      }

      const { FileSystem } = await import("expo-file-system");
      const uri = FileSystem.cacheDirectory + `rigo_response_${Date.now()}.mp3`;
      await FileSystem.writeAsStringAsync(uri, base64Audio, { encoding: FileSystem.EncodingType.Base64 });

      await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true });

      const { sound } = await Audio.Sound.createAsync({ uri }, { shouldPlay: true });
      soundRef.current = sound;

      sound.setOnPlaybackStatusUpdate((status) => {
        if (status.isLoaded && status.didJustFinish) {
          setVoiceState("idle");
          sound.unloadAsync().catch(() => {});
          soundRef.current = null;
        }
      });
    } catch (err) {
      console.warn("Audio playback error:", err);
      setVoiceState("idle");
    }
  };

  const handleSessionExpired = async () => {
    setVoiceState("idle");
    setLiveTranscript("");
    setVoiceSessionToken(null);
    await AsyncStorage.removeItem(VOICE_SESSION_KEY);
    await AsyncStorage.removeItem(VOICE_SESSION_EXPIRY_KEY);
    setPinInput("");
    setPinError("Your session expired. Please re-enter your PIN.");
    openPinModal("verify");
  };

  const processTalkSSE = async (resp: Response): Promise<void> => {
    const reader = resp.body?.getReader();
    if (!reader) {
      setVoiceState("idle");
      return;
    }

    const decoder = new TextDecoder();
    let parseBuffer = "";
    const audioChunks: string[] = [];
    let lastEventType = "";
    let playbackStarted = false;
    let mediaSource: MediaSource | null = null;
    let sourceBuffer: SourceBuffer | null = null;
    let webAudio: HTMLAudioElement | null = null;

    const startWebStreamingPlayback = () => {
      if (Platform.OS !== "web" || playbackStarted) return;
      try {
        if (typeof MediaSource !== "undefined" && MediaSource.isTypeSupported("audio/mpeg")) {
          mediaSource = new MediaSource();
          webAudio = new window.Audio();
          webAudio.src = URL.createObjectURL(mediaSource);
          webAudio.onended = () => {
            if (!mediaSource || mediaSource.readyState === "ended") setVoiceState("idle");
          };

          mediaSource.addEventListener("sourceopen", () => {
            if (!mediaSource) return;
            sourceBuffer = mediaSource.addSourceBuffer("audio/mpeg");
            for (const chunk of audioChunks) {
              try {
                const binary = atob(chunk);
                const bytes = new Uint8Array(binary.length);
                for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
                sourceBuffer.appendBuffer(bytes);
              } catch {
              }
            }
          });

          webAudio.play().catch(() => {});
          playbackStarted = true;
        }
      } catch {
      }
    };

    const appendToMediaSource = (base64Chunk: string) => {
      if (!sourceBuffer || sourceBuffer.updating) return;
      try {
        const binary = atob(base64Chunk);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        sourceBuffer.appendBuffer(bytes);
      } catch {
      }
    };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        parseBuffer += decoder.decode(value, { stream: true });
        const lines = parseBuffer.split("\n");
        parseBuffer = lines.pop() ?? "";

        for (const line of lines) {
          if (line.startsWith("event: ")) {
            lastEventType = line.slice(7).trim();
          } else if (line.startsWith("data: ")) {
            try {
              const payload = JSON.parse(line.slice(6)) as Record<string, unknown>;
              const eventType = lastEventType;

              if (eventType === "transcript") {
                const t = payload["transcript"] as string | undefined;
                setLiveTranscript(t ?? "");
              } else if (eventType === "response") {
                const r = payload["response"] as string | undefined;
                const ttsToken = payload["ttsPlaybackToken"] as string | undefined;
                setRigoResponse(r ?? "");
                setVoiceState("speaking");
                refetchCalls();
                if (Platform.OS !== "web" && r && voiceSessionToken) {
                  let streamUrl = `${apiBase}/voice/tts-native?text=${encodeURIComponent(r)}&sessionToken=${encodeURIComponent(voiceSessionToken)}`;
                  if (ttsToken) streamUrl += `&ttsToken=${encodeURIComponent(ttsToken)}`;
                  playbackStarted = true;
                  (async () => {
                    try {
                      if (soundRef.current) {
                        await soundRef.current.unloadAsync();
                        soundRef.current = null;
                      }
                      await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true });
                      const { sound } = await Audio.Sound.createAsync(
                        { uri: streamUrl, headers: { Authorization: `Bearer ${token ?? ""}` } },
                        { shouldPlay: true },
                      );
                      soundRef.current = sound;
                      sound.setOnPlaybackStatusUpdate((status) => {
                        if (status.isLoaded && status.didJustFinish) {
                          setVoiceState("idle");
                          sound.unloadAsync().catch(() => {});
                          soundRef.current = null;
                        }
                      });
                    } catch {
                      setVoiceState("idle");
                    }
                  })();
                }
              } else if (eventType === "audio_chunk") {
                const chunk = payload["chunk"] as string | undefined;
                if (chunk && Platform.OS === "web") {
                  audioChunks.push(chunk);
                  if (!playbackStarted && audioChunks.length === 1) {
                    startWebStreamingPlayback();
                  } else if (playbackStarted && sourceBuffer && !sourceBuffer.updating) {
                    appendToMediaSource(chunk);
                  }
                }
              } else if (eventType === "error") {
                const errorMsg = payload["message"] as string | undefined;
                setVoiceState("idle");
                setRigoResponse(errorMsg ?? "An error occurred. Please try again.");
                if ((payload["error"] as string) === "insufficient_balance") {
                  Alert.alert("Low Balance", "Top up your voice credits to keep using Rigo.");
                }
              } else if (eventType === "pin_required") {
                const reason = payload["reason"] as string | undefined;
                const pendingTranscript = payload["transcript"] as string | undefined;
                if (pendingTranscript) setPendingHighRiskTranscript(pendingTranscript);
                setVoiceState("idle");
                setRigoResponse("This action needs your PIN to confirm. Please verify your identity first.");
                Alert.alert(
                  "PIN Required",
                  reason ?? "This action requires your PIN for security.",
                  [
                    { text: "Cancel", style: "cancel", onPress: () => setPendingHighRiskTranscript(null) },
                    { text: "Verify PIN", onPress: () => openPinModal("verify") },
                  ],
                );
              } else if (eventType === "done") {
                refetchVoicePrefs();
                const lowBal = payload["lowBalance"] as boolean | undefined;
                if (lowBal) {
                  const lowBalText = "Your voice credit balance is running low. Please top up soon to continue using Rigo.";
                  if (Platform.OS === "web" && typeof window !== "undefined" && "speechSynthesis" in window) {
                    try {
                      const utter = new window.SpeechSynthesisUtterance(lowBalText);
                      utter.lang = "en-GB";
                      window.speechSynthesis.speak(utter);
                    } catch {
                    }
                  } else if (Platform.OS !== "web" && voiceSessionToken) {
                    try {
                      const ttsUrl = `${apiBase}/voice/tts-native?text=${encodeURIComponent(lowBalText)}&sessionToken=${encodeURIComponent(voiceSessionToken)}`;
                      const { sound: lowBalSound } = await Audio.Sound.createAsync(
                        { uri: ttsUrl, headers: { Authorization: `Bearer ${token ?? ""}` } },
                        { shouldPlay: true },
                      );
                      lowBalSound.setOnPlaybackStatusUpdate((s) => {
                        if (s.isLoaded && s.didJustFinish) lowBalSound.unloadAsync();
                      });
                    } catch {
                    }
                  }
                  setTimeout(() => Alert.alert("Low Balance", "Top up your voice credits to keep using Rigo."), 500);
                }
                if (mediaSource && mediaSource.readyState === "open" && sourceBuffer && !sourceBuffer.updating) {
                  mediaSource.endOfStream();
                }
              }
            } catch {
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    if (!playbackStarted && audioChunks.length > 0) {
      const fullAudio = audioChunks.join("");
      await playAudioBase64(fullAudio);
    } else if (!playbackStarted) {
      setTimeout(() => setVoiceState("idle"), 3500);
    }
  };

  const sendVoiceMessage = async (audioBase64: string | null, textInput?: string, confirm?: boolean, confirmToken?: string) => {
    setVoiceState("processing");
    if (textInput) setLiveTranscript(textInput);
    else setLiveTranscript("");

    try {
      const body: Record<string, unknown> = { businessId: activeBusinessId ?? "" };
      if (Platform.OS !== "web") body["platform"] = "native";
      if (selectedVoiceAgentId) body["agentId"] = selectedVoiceAgentId;
      if (confirm) {
        body["confirm"] = true;
        const token = confirmToken ?? highRiskConfirmToken;
        if (token) body["highRiskConfirmToken"] = token;
      }
      if (textInput) {
        body["text"] = textInput;
      } else {
        body["audio"] = audioBase64 ?? "";
      }

      const resp = await fetch(`${apiBase}/voice/talk`, {
        method: "POST",
        headers: voiceHeaders,
        body: JSON.stringify(body),
      });

      if (resp.status === 401) {
        await handleSessionExpired();
        return;
      }

      if (resp.status === 402) {
        const data = await resp.json() as { message?: string };
        setVoiceState("idle");
        setLiveTranscript("");
        setRigoResponse("Your balance is too low. Please top up your wallet.");
        Alert.alert("Low Balance", data.message ?? "Please top up your wallet.");
        return;
      }

      if (!resp.ok) {
        setVoiceState("idle");
        setLiveTranscript("");
        setRigoResponse("Something went wrong. Please try again.");
        return;
      }

      await processTalkSSE(resp);
    } catch {
      setVoiceState("idle");
      setLiveTranscript("");
      setRigoResponse("Connection error. Please check your internet and try again.");
    }
  };

  const handleMicPressIn = async () => {
    if (!voicePrefs || !voicePrefs.hasPinSet) {
      openPinModal("setup");
      return;
    }
    if (!voiceSessionToken) {
      openPinModal("verify");
      return;
    }
    if (voiceState !== "idle") return;

    const started = await startRecording();
    if (started) {
      setVoiceState("recording");
      setLiveTranscript("Listening...");
      setRigoResponse("");
      setShowSuggestedCommands(false);
    }
  };

  const handleMicPressOut = async () => {
    if (voiceState !== "recording") return;
    const base64 = await stopRecordingAndGetBase64();
    await sendVoiceMessage(base64);
  };

  const handleMicTap = async () => {
    if (!voicePrefs || !voicePrefs.hasPinSet) {
      openPinModal("setup");
      return;
    }
    if (!voiceSessionToken) {
      openPinModal("verify");
      return;
    }
  };

  const handleMicRelease = async () => {
    if (voiceState !== "recording") return;
    const base64 = await stopRecordingAndGetBase64();
    await sendVoiceMessage(base64);
  };

  const handleSuggestedCommand = async (command: string) => {
    if (!voicePrefs?.hasPinSet) {
      openPinModal("setup");
      return;
    }
    if (!voiceSessionToken) {
      openPinModal("verify");
      return;
    }

    setLiveTranscript(command);
    setShowSuggestedCommands(false);
    await sendVoiceMessage(null, command);
  };

  const saveLanguagePrefs = async () => {
    setLocaleLoading(true);
    try {
      await fetch(`${apiBase}/voice/voice-preferences`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ inputLocale, outputLocale }),
      });
      refetchVoicePrefs();
      setShowPrefsModal(false);
    } catch {
      Alert.alert("Error", "Failed to save preferences");
    } finally {
      setLocaleLoading(false);
    }
  };

  const purchasePhoneNumber = async () => {
    if (!activeBusinessId) return;
    setPurchasingNumber(true);
    try {
      const resp = await fetch(`${apiBase}/voice/numbers/purchase`, {
        method: "POST",
        headers,
        body: JSON.stringify({ businessId: activeBusinessId, countryCode: "GB" }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        Alert.alert("Cannot Purchase", data.message ?? data.error ?? "Purchase failed");
        return;
      }
      Alert.alert("Number Purchased!", `Your new number ${data.phoneNumber} has been activated.`);
      refetchNumbers();
    } catch {
      Alert.alert("Error", "Connection error. Please try again.");
    } finally {
      setPurchasingNumber(false);
    }
  };

  const assignNumberToAgent = async (numberId: string, agentId: string | null) => {
    setAssigningNumberId(numberId);
    try {
      const resp = await fetch(`${apiBase}/voice/numbers/${numberId}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ agentId }),
      });
      if (!resp.ok) {
        const err = await resp.json() as { error?: string };
        Alert.alert("Error", err.error ?? "Failed to update assignment");
        return;
      }
      refetchNumbers();
    } catch {
      Alert.alert("Error", "Connection error. Please try again.");
    } finally {
      setAssigningNumberId(null);
    }
  };

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

  const formatBalance = (pence: number) => `£${(pence / 100).toFixed(2)}`;

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
  };

  const getMicLabel = () => {
    switch (voiceState) {
      case "recording": return "Release to send";
      case "processing": return liveTranscript ? `Thinking${processingDots}` : `Transcribing${processingDots}`;
      case "speaking": return "Rigo is speaking...";
      default: return voicePrefs?.hasPinSet ? (voiceSessionToken ? "Hold to speak" : "Tap to unlock") : "Set up voice PIN";
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Communications</Text>
        {activeTab === "contacts" && (
          <TouchableOpacity style={styles.addBtn} onPress={() => setShowAddContact(true)}>
            <Feather name="plus" size={18} color="#0A0A0A" />
          </TouchableOpacity>
        )}
        {activeTab === "voice" && (
          <View style={styles.voiceHeaderActions}>
            <TouchableOpacity onPress={() => setShowPrefsModal(true)} style={styles.iconBtn}>
              <Feather name="settings" size={18} color="#8A8A8A" />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setShowNumbersModal(true)} style={styles.iconBtn}>
              <Feather name="phone" size={18} color="#8A8A8A" />
            </TouchableOpacity>
          </View>
        )}
      </View>

      <View style={styles.tabs}>
        {(["contacts", "campaigns", "voice"] as Tab[]).map((tab) => (
          <TouchableOpacity
            key={tab}
            style={[styles.tab, activeTab === tab && styles.activeTab]}
            onPress={() => setActiveTab(tab)}
          >
            <Text style={[styles.tabText, activeTab === tab && styles.activeTabText]}>
              {tab === "voice" ? "Voice" : tab.charAt(0).toUpperCase() + tab.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {activeTab === "voice" ? (
        <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false} contentContainerStyle={styles.voiceScrollContent}>
          <View style={styles.voiceCard}>
            <View style={styles.rigoAvatarContainer}>
              <View style={styles.waveformRow}>
                {[waveAnim, waveAnim2, waveAnim3, waveAnim2, waveAnim].map((anim, i) => (
                  <Animated.View
                    key={i}
                    style={[
                      styles.waveBar,
                      {
                        transform: [{ scaleY: anim }],
                        backgroundColor: voiceState === "speaking" ? GOLD : voiceState === "recording" ? "#EF4444" : "#3A3A3A",
                        height: i === 2 ? 40 : i === 1 || i === 3 ? 28 : 18,
                      },
                    ]}
                  />
                ))}
              </View>
              <Text style={styles.rigoName}>Rigo</Text>
              <Text style={styles.rigoSubtitle}>GoRigo Voice Assistant</Text>
            </View>

            {voicePrefs && (
              <View style={styles.balanceBadgeRow}>
                <View style={styles.balanceBadge}>
                  <Feather name="credit-card" size={12} color={GOLD} />
                  <Text style={styles.balanceText}>{formatBalance(voicePrefs.walletBalancePence)}</Text>
                  {(voicePrefs.walletBalancePence ?? 0) < 100 && (
                    <Text style={styles.lowBalanceWarning}> · Low</Text>
                  )}
                </View>
                {(voicePrefs.walletBalancePence ?? 0) < 200 && (
                  <TouchableOpacity
                    style={styles.topUpBtn}
                    onPress={() => {
                      Alert.alert(
                        "Top Up Voice Credits",
                        "Visit the Wallet section in Settings to add voice credits and continue using Rigo.",
                        [{ text: "OK" }],
                      );
                    }}
                  >
                    <Feather name="plus-circle" size={12} color={GOLD} />
                    <Text style={styles.topUpBtnText}>Top Up</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}

            {agentsList.length > 0 && (
              <View style={styles.agentSelectorContainer}>
                <Text style={styles.agentSelectorLabel}>Speak with agent:</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.agentSelectorScroll}>
                  <TouchableOpacity
                    style={[styles.agentChip, selectedVoiceAgentId === null && styles.agentChipSelected]}
                    onPress={() => setSelectedVoiceAgentId(null)}
                  >
                    <Text style={[styles.agentChipText, selectedVoiceAgentId === null && styles.agentChipTextSelected]}>
                      Rigo (General)
                    </Text>
                  </TouchableOpacity>
                  {agentsList.map((agent) => (
                    <TouchableOpacity
                      key={agent.id}
                      style={[styles.agentChip, selectedVoiceAgentId === agent.id && styles.agentChipSelected]}
                      onPress={() => setSelectedVoiceAgentId(agent.id)}
                    >
                      <Text style={[styles.agentChipText, selectedVoiceAgentId === agent.id && styles.agentChipTextSelected]}>
                        {agent.name}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            )}

            {(liveTranscript || rigoResponse || voiceState === "processing") ? (
              <View style={styles.transcriptContainer}>
                {liveTranscript ? (
                  <View style={styles.transcriptBubble}>
                    <Text style={styles.transcriptLabel}>You said</Text>
                    <Text style={styles.transcriptText}>{liveTranscript}</Text>
                  </View>
                ) : voiceState === "processing" ? (
                  <View style={styles.transcriptBubble}>
                    <Text style={styles.transcriptLabel}>Transcribing</Text>
                    <Text style={[styles.transcriptText, { color: "#777", fontStyle: "italic" }]}>Listening{processingDots}</Text>
                  </View>
                ) : null}
                {rigoResponse ? (
                  <View style={styles.rigoBubble}>
                    <Text style={styles.transcriptLabel}>Rigo</Text>
                    <Text style={styles.rigoResponseText}>{rigoResponse}</Text>
                  </View>
                ) : voiceState === "processing" && liveTranscript ? (
                  <View style={styles.rigoBubble}>
                    <Text style={styles.transcriptLabel}>Rigo</Text>
                    <Text style={[styles.rigoResponseText, { color: "#777", fontStyle: "italic" }]}>Thinking{processingDots}</Text>
                  </View>
                ) : null}
              </View>
            ) : null}

            {showSuggestedCommands && (
              <View style={styles.suggestedCommands}>
                <Text style={styles.suggestedLabel}>Try asking:</Text>
                {SUGGESTED_COMMANDS.map((cmd) => (
                  <TouchableOpacity
                    key={cmd}
                    style={styles.commandChip}
                    onPress={() => handleSuggestedCommand(cmd)}
                  >
                    <Text style={styles.commandChipText}>{cmd}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
              <Pressable
                style={[
                  styles.micButton,
                  voiceState === "recording" && styles.micButtonRecording,
                  voiceState === "processing" && styles.micButtonProcessing,
                  voiceState === "speaking" && styles.micButtonSpeaking,
                ]}
                onPress={handleMicTap}
                onPressIn={handleMicPressIn}
                onPressOut={handleMicPressOut}
                disabled={voiceState === "processing" || voiceState === "speaking"}
              >
                {voiceState === "processing" ? (
                  <ActivityIndicator color="#FFFFFF" size="large" />
                ) : (
                  <Feather
                    name={voiceState === "recording" ? "mic" : voiceState === "speaking" ? "volume-2" : "mic"}
                    size={32}
                    color="#FFFFFF"
                  />
                )}
              </Pressable>
            </Animated.View>

            <Text style={styles.micLabel}>{getMicLabel()}</Text>

            {!voiceSessionToken && voicePrefs?.hasPinSet && (
              <TouchableOpacity
                onPress={() => openPinModal("verify")}
                style={styles.unlockBtn}
              >
                <Feather name="lock" size={14} color={GOLD} />
                <Text style={styles.unlockBtnText}>Unlock with PIN</Text>
              </TouchableOpacity>
            )}
          </View>

          {(voiceCalls?.calls?.length ?? 0) > 0 && (
            <View style={styles.callHistorySection}>
              <Text style={styles.sectionTitle}>Recent Interactions</Text>
              {voiceCalls!.calls.map((call) => (
                <View key={call.id} style={styles.callCard}>
                  <View style={styles.callCardLeft}>
                    <View style={styles.callIcon}>
                      <Feather name="mic" size={14} color={GOLD} />
                    </View>
                    <View style={styles.callInfo}>
                      <Text style={styles.callSummary} numberOfLines={2}>
                        {call.transcriptSummary ?? "Voice interaction"}
                      </Text>
                      <Text style={styles.callMeta}>
                        {call.agentName ? `${call.agentName} · ` : ""}{formatDate(call.createdAt)} · {call.creditsUsed}p
                      </Text>
                    </View>
                  </View>
                </View>
              ))}
            </View>
          )}
        </ScrollView>
      ) : (
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
      )}

      {/* PIN Modal */}
      <Modal visible={showPinModal} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={styles.modal}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{pinMode === "setup" ? "Set Voice PIN" : "Enter Voice PIN"}</Text>
            <TouchableOpacity onPress={() => { setShowPinModal(false); setPinInput(""); setPinError(""); }}>
              <Feather name="x" size={22} color="#FFFFFF" />
            </TouchableOpacity>
          </View>
          <ScrollView style={styles.modalContent}>
            <View style={styles.pinContainer}>
              <View style={styles.pinIconContainer}>
                <Feather name="lock" size={40} color={GOLD} />
              </View>
              <Text style={styles.pinTitle}>
                {pinMode === "setup" ? "Create Your Voice PIN" : "Voice PIN Required"}
              </Text>
              <Text style={styles.pinSubtitle}>
                {pinMode === "setup"
                  ? "Set a 4-digit PIN to secure your voice session. You'll need this each time you open a new voice session."
                  : "Enter your 4-digit PIN to activate the microphone. Your session will remain active for 5 minutes."}
              </Text>
              <TextInput
                style={styles.pinInput}
                value={pinInput}
                onChangeText={(t) => { setPinInput(t.replace(/\D/g, "").slice(0, 4)); setPinError(""); }}
                placeholder="••••"
                placeholderTextColor="#555"
                keyboardType="number-pad"
                maxLength={4}
                secureTextEntry
                textAlign="center"
              />
              {pinError ? <Text style={styles.pinError}>{pinError}</Text> : null}
              <View style={styles.pinDots}>
                {[0, 1, 2, 3].map((i) => (
                  <View key={i} style={[styles.pinDot, pinInput.length > i && styles.pinDotFilled]} />
                ))}
              </View>
            </View>
          </ScrollView>
          <View style={styles.modalFooter}>
            <TouchableOpacity
              style={[styles.createBtn, pinInput.length !== 4 && styles.createBtnDisabled]}
              onPress={() => (pinMode === "setup" ? handleSetPin() : handleVerifyPin())}
              disabled={pinInput.length !== 4 || pinLoading}
            >
              {pinLoading ? (
                <ActivityIndicator color="#0A0A0A" />
              ) : (
                <Text style={styles.createBtnText}>{pinMode === "setup" ? "Set PIN" : "Unlock Voice"}</Text>
              )}
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </Modal>

      {/* Language Preferences Modal */}
      <Modal visible={showPrefsModal} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={styles.modal}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Voice Preferences</Text>
            <TouchableOpacity onPress={() => setShowPrefsModal(false)}>
              <Feather name="x" size={22} color="#FFFFFF" />
            </TouchableOpacity>
          </View>
          <ScrollView style={styles.modalContent}>
            <Text style={styles.prefSection}>My Language (Input)</Text>
            <Text style={styles.prefDesc}>The language you speak into the microphone</Text>
            <View style={styles.localeList}>
              {LOCALES.map((loc) => (
                <TouchableOpacity
                  key={loc.code}
                  style={[styles.localeOption, inputLocale === loc.code && styles.localeOptionActive]}
                  onPress={() => setInputLocale(loc.code)}
                >
                  <Text style={[styles.localeOptionText, inputLocale === loc.code && styles.localeOptionTextActive]}>
                    {loc.label}
                  </Text>
                  {inputLocale === loc.code && <Feather name="check" size={16} color={GOLD} />}
                </TouchableOpacity>
              ))}
            </View>

            <Text style={[styles.prefSection, { marginTop: 24 }]}>Rigo's Output Language</Text>
            <Text style={styles.prefDesc}>The language and accent Rigo responds in</Text>
            <View style={styles.localeList}>
              {LOCALES.map((loc) => (
                <TouchableOpacity
                  key={loc.code}
                  style={[styles.localeOption, outputLocale === loc.code && styles.localeOptionActive]}
                  onPress={() => setOutputLocale(loc.code)}
                >
                  <Text style={[styles.localeOptionText, outputLocale === loc.code && styles.localeOptionTextActive]}>
                    {loc.label}
                  </Text>
                  {outputLocale === loc.code && <Feather name="check" size={16} color={GOLD} />}
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>
          <View style={styles.modalFooter}>
            <TouchableOpacity
              style={styles.createBtn}
              onPress={saveLanguagePrefs}
              disabled={localeLoading}
            >
              {localeLoading ? <ActivityIndicator color="#0A0A0A" /> : <Text style={styles.createBtnText}>Save Preferences</Text>}
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </Modal>

      {/* Phone Numbers Modal */}
      <Modal visible={showNumbersModal} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={styles.modal}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Phone Numbers</Text>
            <TouchableOpacity onPress={() => setShowNumbersModal(false)}>
              <Feather name="x" size={22} color="#FFFFFF" />
            </TouchableOpacity>
          </View>
          <ScrollView style={styles.modalContent}>
            <Text style={styles.prefDesc}>
              Purchase a dedicated phone number for your business or assign one to a specific agent. Numbers cost £5 to activate and £2.99/month.
            </Text>

            {(phoneNumbers?.numbers?.length ?? 0) === 0 ? (
              <View style={styles.numbersEmpty}>
                <Feather name="phone-missed" size={36} color="#2A2A2A" />
                <Text style={styles.emptyTitle}>No numbers yet</Text>
                <Text style={styles.emptySubtitle}>Purchase a UK phone number to get started</Text>
              </View>
            ) : (
              <View style={styles.numbersList}>
                {phoneNumbers!.numbers.map((num) => (
                  <View key={num.id} style={styles.numberCard}>
                    <Feather name="phone" size={18} color={GOLD} />
                    <View style={{ flex: 1, marginLeft: 12 }}>
                      <Text style={styles.numberText}>{num.phoneNumber ?? "Unknown"}</Text>
                      <Text style={styles.numberMeta}>
                        £{parseInt(num.monthlyFeePence) / 100}/mo
                      </Text>
                      <Text style={styles.numberAssignLabel}>Assign to:</Text>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 4 }}>
                        <TouchableOpacity
                          style={[styles.assignChip, !num.agentId && styles.assignChipActive]}
                          onPress={() => assignNumberToAgent(num.id, null)}
                          disabled={assigningNumberId === num.id}
                        >
                          <Text style={[styles.assignChipText, !num.agentId && styles.assignChipTextActive]}>
                            Business
                          </Text>
                        </TouchableOpacity>
                        {agentsList.map((agent) => (
                          <TouchableOpacity
                            key={agent.id}
                            style={[styles.assignChip, num.agentId === agent.id && styles.assignChipActive]}
                            onPress={() => assignNumberToAgent(num.id, agent.id)}
                            disabled={assigningNumberId === num.id}
                          >
                            <Text style={[styles.assignChipText, num.agentId === agent.id && styles.assignChipTextActive]}>
                              {agent.name}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </ScrollView>
                    </View>
                    {assigningNumberId === num.id && (
                      <ActivityIndicator size="small" color={GOLD} />
                    )}
                  </View>
                ))}
              </View>
            )}
          </ScrollView>
          <View style={styles.modalFooter}>
            <TouchableOpacity
              style={styles.createBtn}
              onPress={purchasePhoneNumber}
              disabled={purchasingNumber}
            >
              {purchasingNumber ? (
                <ActivityIndicator color="#0A0A0A" />
              ) : (
                <Text style={styles.createBtnText}>Purchase UK Number (£5)</Text>
              )}
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </Modal>

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
  voiceHeaderActions: { flexDirection: "row", gap: 8 },
  iconBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "#1A1A1A",
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#2A2A2A",
  },
  tabs: { flexDirection: "row", paddingHorizontal: 20, gap: 8, marginBottom: 16 },
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
  voiceScrollContent: { paddingBottom: 40 },

  voiceCard: {
    marginHorizontal: 20,
    backgroundColor: "#111111",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#2A2A2A",
    padding: 24,
    alignItems: "center",
    marginBottom: 20,
  },
  rigoAvatarContainer: { alignItems: "center", marginBottom: 16 },
  waveformRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 56,
    marginBottom: 12,
  },
  waveBar: {
    width: 6,
    borderRadius: 3,
  },
  rigoName: { fontSize: 22, fontFamily: "Inter_700Bold", color: "#FFFFFF", letterSpacing: -0.5 },
  rigoSubtitle: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#555", marginTop: 2 },

  balanceBadgeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 16,
  },
  balanceBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.goldMuted,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
    gap: 6,
  },
  balanceText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: GOLD },
  lowBalanceWarning: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#EF4444" },
  topUpBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1A1200",
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 6,
    gap: 4,
    borderWidth: 1,
    borderColor: GOLD,
  },
  topUpBtnText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: GOLD },

  transcriptContainer: { width: "100%", marginBottom: 16, gap: 8 },
  transcriptBubble: {
    backgroundColor: "#1A1A1A",
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: "#2A2A2A",
  },
  rigoBubble: {
    backgroundColor: Colors.goldMuted,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: "#2A1A00",
  },
  transcriptLabel: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: "#555", marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 },
  transcriptText: { fontSize: 14, fontFamily: "Inter_400Regular", color: "#FFFFFF" },
  rigoResponseText: { fontSize: 14, fontFamily: "Inter_400Regular", color: "#FFFFFF" },

  agentSelectorContainer: { width: "100%", marginBottom: 12 },
  agentSelectorLabel: { fontSize: 11, fontFamily: "Inter_500Medium", color: "#555", marginBottom: 6, textAlign: "center" },
  agentSelectorScroll: { flexDirection: "row" },
  agentChip: {
    backgroundColor: "#1A1A1A",
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginRight: 6,
    borderWidth: 1,
    borderColor: "#2A2A2A",
  },
  agentChipSelected: { backgroundColor: "#1A1200", borderColor: GOLD },
  agentChipText: { fontSize: 12, fontFamily: "Inter_400Regular", color: "#666" },
  agentChipTextSelected: { color: GOLD, fontFamily: "Inter_500Medium" },

  numberAssignLabel: { fontSize: 11, fontFamily: "Inter_500Medium", color: "#555", marginTop: 6 },
  assignChip: {
    backgroundColor: "#151515",
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginRight: 6,
    borderWidth: 1,
    borderColor: "#2A2A2A",
  },
  assignChipActive: { backgroundColor: "#1A1200", borderColor: GOLD },
  assignChipText: { fontSize: 11, fontFamily: "Inter_400Regular", color: "#666" },
  assignChipTextActive: { color: GOLD },

  suggestedCommands: { width: "100%", marginBottom: 16 },
  suggestedLabel: { fontSize: 12, fontFamily: "Inter_500Medium", color: "#555", marginBottom: 8, textAlign: "center" },
  commandChip: {
    backgroundColor: "#1A1A1A",
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "#2A2A2A",
  },
  commandChipText: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#AAAAAA", textAlign: "center" },

  micButton: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: "#1A1A1A",
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 2,
    borderColor: "#3A3A3A",
    marginBottom: 12,
  },
  micButtonRecording: { backgroundColor: "#7F1D1D", borderColor: "#EF4444" },
  micButtonProcessing: { backgroundColor: "#1A1A00", borderColor: "#F59E0B" },
  micButtonSpeaking: { backgroundColor: "#1A0A00", borderColor: GOLD },
  micLabel: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#555", marginBottom: 8 },

  unlockBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 4,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: Colors.goldMuted,
    borderRadius: 20,
  },
  unlockBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: GOLD },

  callHistorySection: { marginHorizontal: 20 },
  sectionTitle: { fontSize: 16, fontFamily: "Inter_700Bold", color: "#FFFFFF", marginBottom: 12 },
  callCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#1A1A1A",
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "#2A2A2A",
  },
  callCardLeft: { flexDirection: "row", alignItems: "center", flex: 1 },
  callIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Colors.goldMuted,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 10,
  },
  callInfo: { flex: 1 },
  callSummary: { fontSize: 14, fontFamily: "Inter_400Regular", color: "#FFFFFF" },
  callMeta: { fontSize: 12, fontFamily: "Inter_400Regular", color: "#555", marginTop: 2 },

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

  pinContainer: { alignItems: "center", paddingVertical: 20 },
  pinIconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: Colors.goldMuted,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 20,
  },
  pinTitle: { fontSize: 20, fontFamily: "Inter_700Bold", color: "#FFFFFF", marginBottom: 8, textAlign: "center" },
  pinSubtitle: { fontSize: 14, fontFamily: "Inter_400Regular", color: "#8A8A8A", textAlign: "center", marginBottom: 28, lineHeight: 20 },
  pinInput: {
    backgroundColor: "#1A1A1A",
    borderColor: "#2A2A2A",
    borderWidth: 1,
    borderRadius: 10,
    padding: 16,
    fontSize: 28,
    fontFamily: "Inter_700Bold",
    color: "#FFFFFF",
    width: 160,
    marginBottom: 16,
    letterSpacing: 12,
  },
  pinDots: { flexDirection: "row", gap: 12, marginBottom: 8 },
  pinDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: "#2A2A2A" },
  pinDotFilled: { backgroundColor: GOLD },
  pinError: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#EF4444", marginBottom: 8, textAlign: "center" },

  prefSection: { fontSize: 15, fontFamily: "Inter_700Bold", color: "#FFFFFF", marginBottom: 4 },
  prefDesc: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#555", marginBottom: 16, lineHeight: 18 },
  localeList: { gap: 8 },
  localeOption: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#1A1A1A",
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: "#2A2A2A",
  },
  localeOptionActive: { borderColor: GOLD, backgroundColor: Colors.goldMuted },
  localeOptionText: { fontSize: 14, fontFamily: "Inter_400Regular", color: "#8A8A8A" },
  localeOptionTextActive: { color: "#FFFFFF", fontFamily: "Inter_600SemiBold" },

  numbersEmpty: { alignItems: "center", paddingTop: 40, gap: 12 },
  numbersList: { gap: 8 },
  numberCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1A1A1A",
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: "#2A2A2A",
  },
  numberText: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: "#FFFFFF" },
  numberMeta: { fontSize: 12, fontFamily: "Inter_400Regular", color: "#555", marginTop: 2 },
});
