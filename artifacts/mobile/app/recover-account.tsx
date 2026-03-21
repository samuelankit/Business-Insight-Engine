import React, { useState, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Alert,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import Colors from "@/constants/colors";
import { useApp } from "@/context/AppContext";

const GOLD = Colors.gold;

type RecoverStep = "email" | "otp" | "success";

export default function RecoverAccountScreen() {
  const { loginWithRecovery, getDeviceId } = useApp();
  const router = useRouter();
  const [step, setStep] = useState<RecoverStep>("email");
  const [email, setEmail] = useState("");
  const [otpDigits, setOtpDigits] = useState(["", "", "", "", "", ""]);
  const [isLoading, setIsLoading] = useState(false);
  const otpRefs = useRef<(TextInput | null)[]>([]);

  const apiBase = `https://${process.env["EXPO_PUBLIC_DOMAIN"]}/api`;

  const handleRequestOtp = async () => {
    if (!email.trim()) {
      Alert.alert("Required", "Please enter your email address.");
      return;
    }
    setIsLoading(true);
    try {
      const resp = await fetch(`${apiBase}/auth/email/recover-request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      if (resp.ok) {
        setStep("otp");
      } else {
        const data = await resp.json().catch(() => ({}));
        Alert.alert("Error", data.error || "Failed to send verification code.");
      }
    } catch {
      Alert.alert("Error", "Network error. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleOtpChange = (index: number, value: string) => {
    if (value.length > 1) {
      const digits = value.replace(/[^0-9]/g, "").slice(0, 6).split("");
      const newOtp = [...otpDigits];
      digits.forEach((d, i) => {
        if (index + i < 6) newOtp[index + i] = d;
      });
      setOtpDigits(newOtp);
      const nextIdx = Math.min(index + digits.length, 5);
      otpRefs.current[nextIdx]?.focus();
      return;
    }
    const newOtp = [...otpDigits];
    newOtp[index] = value.replace(/[^0-9]/g, "");
    setOtpDigits(newOtp);
    if (value && index < 5) {
      otpRefs.current[index + 1]?.focus();
    }
  };

  const handleOtpKeyPress = (index: number, key: string) => {
    if (key === "Backspace" && !otpDigits[index] && index > 0) {
      otpRefs.current[index - 1]?.focus();
    }
  };

  const handleVerifyOtp = async () => {
    const code = otpDigits.join("");
    if (code.length !== 6) {
      Alert.alert("Required", "Please enter the full 6-digit code.");
      return;
    }
    setIsLoading(true);
    try {
      const deviceId = await getDeviceId();
      const resp = await fetch(`${apiBase}/auth/email/recover-verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          code,
          deviceId,
          platform: Platform.OS,
        }),
      });
      const data = await resp.json();
      if (resp.ok && data.success) {
        await loginWithRecovery(data.userId, data.token);
        setStep("success");
      } else {
        Alert.alert("Error", data.error || "Invalid verification code.");
      }
    } catch {
      Alert.alert("Error", "Network error. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleResendOtp = async () => {
    setIsLoading(true);
    try {
      await fetch(`${apiBase}/auth/email/recover-request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      Alert.alert("Sent", "A new verification code has been sent to your email.");
      setOtpDigits(["", "", "", "", "", ""]);
    } catch {
      Alert.alert("Error", "Failed to resend code.");
    } finally {
      setIsLoading(false);
    }
  };

  const renderStep = () => {
    switch (step) {
      case "email":
        return (
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : "height"}
            style={styles.stepContent}
          >
            <View style={styles.iconContainer}>
              <Feather name="shield" size={32} color={GOLD} />
            </View>
            <Text style={styles.title}>Recover Your Account</Text>
            <Text style={styles.subtitle}>
              Enter the email address linked to your GoRigo account. We'll send you a verification code.
            </Text>

            <Text style={styles.fieldLabel}>Email Address</Text>
            <TextInput
              style={styles.textInput}
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              placeholderTextColor="#555"
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
            />

            <TouchableOpacity
              style={[styles.primaryBtn, !email.trim() && styles.btnDisabled]}
              onPress={handleRequestOtp}
              disabled={isLoading || !email.trim()}
            >
              {isLoading ? (
                <ActivityIndicator color="#0A0A0A" />
              ) : (
                <>
                  <Text style={styles.primaryBtnText}>Send Code</Text>
                  <Feather name="arrow-right" size={18} color="#0A0A0A" />
                </>
              )}
            </TouchableOpacity>
          </KeyboardAvoidingView>
        );

      case "otp":
        return (
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : "height"}
            style={styles.stepContent}
          >
            <View style={styles.iconContainer}>
              <Feather name="mail" size={32} color={GOLD} />
            </View>
            <Text style={styles.title}>Enter Verification Code</Text>
            <Text style={styles.subtitle}>
              We sent a 6-digit code to {email}. Enter it below.
            </Text>

            <View style={styles.otpRow}>
              {otpDigits.map((digit, i) => (
                <TextInput
                  key={i}
                  ref={(ref) => { otpRefs.current[i] = ref; }}
                  style={[styles.otpInput, digit && styles.otpInputFilled]}
                  value={digit}
                  onChangeText={(v) => handleOtpChange(i, v)}
                  onKeyPress={({ nativeEvent }) => handleOtpKeyPress(i, nativeEvent.key)}
                  keyboardType="number-pad"
                  maxLength={1}
                  textContentType="oneTimeCode"
                />
              ))}
            </View>

            <TouchableOpacity
              style={[styles.primaryBtn, otpDigits.join("").length !== 6 && styles.btnDisabled]}
              onPress={handleVerifyOtp}
              disabled={isLoading || otpDigits.join("").length !== 6}
            >
              {isLoading ? (
                <ActivityIndicator color="#0A0A0A" />
              ) : (
                <>
                  <Text style={styles.primaryBtnText}>Verify & Recover</Text>
                  <Feather name="check" size={18} color="#0A0A0A" />
                </>
              )}
            </TouchableOpacity>

            <TouchableOpacity style={styles.resendBtn} onPress={handleResendOtp} disabled={isLoading}>
              <Text style={styles.resendText}>Didn't receive a code? Resend</Text>
            </TouchableOpacity>
          </KeyboardAvoidingView>
        );

      case "success":
        return (
          <View style={[styles.stepContent, { alignItems: "center" }]}>
            <View style={styles.successIcon}>
              <Feather name="check" size={40} color={GOLD} />
            </View>
            <Text style={styles.title}>Account Recovered!</Text>
            <Text style={styles.subtitle}>
              Your account has been restored on this device. All your data is ready.
            </Text>
            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={() => router.replace("/(tabs)")}
            >
              <Text style={styles.primaryBtnText}>Go to Dashboard</Text>
              <Feather name="arrow-right" size={18} color="#0A0A0A" />
            </TouchableOpacity>
          </View>
        );
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="arrow-left" size={22} color="#FFFFFF" />
        </TouchableOpacity>
      </View>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {renderStep()}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0A0A0A" },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#1A1A1A",
    justifyContent: "center",
    alignItems: "center",
  },
  scroll: { flex: 1 },
  scrollContent: { flexGrow: 1, padding: 24 },
  stepContent: { flex: 1, paddingTop: 20 },
  iconContainer: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: Colors.goldMuted,
    justifyContent: "center",
    alignItems: "center",
    alignSelf: "center",
    marginBottom: 24,
  },
  title: {
    fontSize: 26,
    fontFamily: "Inter_700Bold",
    color: "#FFFFFF",
    textAlign: "center",
    marginBottom: 12,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    color: "#8A8A8A",
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 32,
  },
  fieldLabel: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    color: "#8A8A8A",
    marginBottom: 10,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  textInput: {
    backgroundColor: "#1A1A1A",
    borderColor: "#2A2A2A",
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    fontFamily: "Inter_400Regular",
    color: "#FFFFFF",
    marginBottom: 24,
  },
  otpRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 10,
    marginBottom: 32,
  },
  otpInput: {
    width: 48,
    height: 56,
    borderRadius: 12,
    backgroundColor: "#1A1A1A",
    borderColor: "#2A2A2A",
    borderWidth: 1,
    textAlign: "center",
    fontSize: 22,
    fontFamily: "Inter_700Bold",
    color: "#FFFFFF",
  },
  otpInputFilled: {
    borderColor: GOLD,
    backgroundColor: Colors.goldMuted,
  },
  primaryBtn: {
    backgroundColor: GOLD,
    borderRadius: 16,
    paddingVertical: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  btnDisabled: { opacity: 0.5 },
  primaryBtnText: { fontSize: 17, fontFamily: "Inter_700Bold", color: "#0A0A0A" },
  resendBtn: { alignItems: "center", paddingVertical: 16 },
  resendText: { fontSize: 14, fontFamily: "Inter_400Regular", color: "#8A8A8A" },
  successIcon: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: Colors.goldMuted,
    borderColor: GOLD,
    borderWidth: 2,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 32,
  },
});
