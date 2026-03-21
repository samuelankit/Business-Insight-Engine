import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { setBaseUrl, setAuthTokenGetter } from "@workspace/api-client-react";
import * as Crypto from "expo-crypto";

const STORAGE_KEYS = {
  TOKEN: "@gorigo/token",
  USER_ID: "@gorigo/user_id",
  ACTIVE_BUSINESS_ID: "@gorigo/active_business_id",
  ONBOARDING_COMPLETE: "@gorigo/onboarding_complete",
  THEME: "@gorigo/theme",
  DEVICE_ID: "@gorigo/device_id",
};

type Theme = "light" | "dark" | "system";

interface AppContextValue {
  userId: string | null;
  token: string | null;
  activeBusinessId: string | null;
  onboardingComplete: boolean;
  theme: Theme;
  isLoading: boolean;
  setActiveBusinessId: (id: string) => Promise<void>;
  completeOnboarding: () => Promise<void>;
  setTheme: (theme: Theme) => Promise<void>;
  logout: () => Promise<void>;
  authenticate: () => Promise<void>;
  loginWithRecovery: (userId: string, token: string) => Promise<void>;
  getDeviceId: () => Promise<string>;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [userId, setUserId] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [activeBusinessId, setActiveBusinessIdState] = useState<string | null>(null);
  const [onboardingComplete, setOnboardingComplete] = useState(false);
  const [theme, setThemeState] = useState<Theme>("light");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const domain = process.env["EXPO_PUBLIC_DOMAIN"];
    if (domain) {
      setBaseUrl(`https://${domain}`);
    }

    setAuthTokenGetter(() => token);

    (async () => {
      try {
        const [
          storedToken,
          storedUserId,
          storedBusinessId,
          storedOnboarding,
          storedTheme,
        ] = await AsyncStorage.multiGet([
          STORAGE_KEYS.TOKEN,
          STORAGE_KEYS.USER_ID,
          STORAGE_KEYS.ACTIVE_BUSINESS_ID,
          STORAGE_KEYS.ONBOARDING_COMPLETE,
          STORAGE_KEYS.THEME,
        ]);

        const t = storedToken[1];
        const uid = storedUserId[1];
        const bid = storedBusinessId[1];

        if (t && uid) {
          setToken(t);
          setUserId(uid);
          setAuthTokenGetter(() => t);
        }

        if (bid) setActiveBusinessIdState(bid);
        if (storedOnboarding[1] === "true") setOnboardingComplete(true);
        if (storedTheme[1]) setThemeState(storedTheme[1] as Theme);

        if (!t) {
          await doAuthenticate();
        }
      } catch (e) {
        console.warn("AppContext init error:", e);
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  const doAuthenticate = async () => {
    try {
      let deviceId = await AsyncStorage.getItem(STORAGE_KEYS.DEVICE_ID);
      if (!deviceId) {
        deviceId = Crypto.randomUUID();
        await AsyncStorage.setItem(STORAGE_KEYS.DEVICE_ID, deviceId);
      }

      const domain = process.env["EXPO_PUBLIC_DOMAIN"];
      const baseUrl = domain ? `https://${domain}` : "";

      const resp = await fetch(`${baseUrl}/api/auth/device`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId, platform: "ios" }),
      });

      if (!resp.ok) return;

      const data = await resp.json();
      if (data.token && data.userId) {
        await AsyncStorage.multiSet([
          [STORAGE_KEYS.TOKEN, data.token],
          [STORAGE_KEYS.USER_ID, data.userId],
        ]);
        setToken(data.token);
        setUserId(data.userId);
        setAuthTokenGetter(() => data.token);
      }
    } catch (e) {
      console.warn("Auth error:", e);
    }
  };

  const authenticate = useCallback(doAuthenticate, []);

  const getDeviceId = useCallback(async () => {
    let deviceId = await AsyncStorage.getItem(STORAGE_KEYS.DEVICE_ID);
    if (!deviceId) {
      deviceId = Crypto.randomUUID();
      await AsyncStorage.setItem(STORAGE_KEYS.DEVICE_ID, deviceId);
    }
    return deviceId;
  }, []);

  const loginWithRecovery = useCallback(async (newUserId: string, newToken: string) => {
    await AsyncStorage.multiSet([
      [STORAGE_KEYS.TOKEN, newToken],
      [STORAGE_KEYS.USER_ID, newUserId],
      [STORAGE_KEYS.ONBOARDING_COMPLETE, "true"],
    ]);
    setToken(newToken);
    setUserId(newUserId);
    setOnboardingComplete(true);
    setAuthTokenGetter(() => newToken);
  }, []);

  const setActiveBusinessId = useCallback(async (id: string) => {
    setActiveBusinessIdState(id);
    await AsyncStorage.setItem(STORAGE_KEYS.ACTIVE_BUSINESS_ID, id);
  }, []);

  const completeOnboarding = useCallback(async () => {
    setOnboardingComplete(true);
    await AsyncStorage.setItem(STORAGE_KEYS.ONBOARDING_COMPLETE, "true");
  }, []);

  const setTheme = useCallback(async (t: Theme) => {
    setThemeState(t);
    await AsyncStorage.setItem(STORAGE_KEYS.THEME, t);
  }, []);

  const logout = useCallback(async () => {
    await AsyncStorage.multiRemove([
      STORAGE_KEYS.TOKEN,
      STORAGE_KEYS.USER_ID,
      STORAGE_KEYS.ACTIVE_BUSINESS_ID,
      STORAGE_KEYS.ONBOARDING_COMPLETE,
    ]);
    setToken(null);
    setUserId(null);
    setActiveBusinessIdState(null);
    setOnboardingComplete(false);
    await doAuthenticate();
  }, []);

  return (
    <AppContext.Provider
      value={{
        userId,
        token,
        activeBusinessId,
        onboardingComplete,
        theme,
        isLoading,
        setActiveBusinessId,
        completeOnboarding,
        setTheme,
        logout,
        authenticate,
        loginWithRecovery,
        getDeviceId,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}
