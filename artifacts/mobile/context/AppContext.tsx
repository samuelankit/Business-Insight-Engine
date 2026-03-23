import { Platform } from "react-native";
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
  IS_ADMIN: "@gorigo/is_admin",
  ADMIN_EMAIL: "@gorigo/admin_email",
};

type Theme = "light" | "dark" | "system";

interface AppContextValue {
  userId: string | null;
  token: string | null;
  activeBusinessId: string | null;
  onboardingComplete: boolean;
  theme: Theme;
  isLoading: boolean;
  isAdmin: boolean;
  adminEmail: string | null;
  setActiveBusinessId: (id: string) => Promise<void>;
  completeOnboarding: () => Promise<void>;
  setTheme: (theme: Theme) => Promise<void>;
  logout: () => Promise<void>;
  authenticate: () => Promise<void>;
  loginWithRecovery: (userId: string, token: string) => Promise<void>;
  loginWithMicrosoft: (code: string, state: string, redirectUri: string) => Promise<{ success: boolean; error?: string }>;
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
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminEmail, setAdminEmail] = useState<string | null>(null);

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
          storedIsAdmin,
          storedAdminEmail,
        ] = await AsyncStorage.multiGet([
          STORAGE_KEYS.TOKEN,
          STORAGE_KEYS.USER_ID,
          STORAGE_KEYS.ACTIVE_BUSINESS_ID,
          STORAGE_KEYS.ONBOARDING_COMPLETE,
          STORAGE_KEYS.THEME,
          STORAGE_KEYS.IS_ADMIN,
          STORAGE_KEYS.ADMIN_EMAIL,
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
        if (storedIsAdmin[1] === "true") setIsAdmin(true);
        if (storedAdminEmail[1]) setAdminEmail(storedAdminEmail[1]);

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
        body: JSON.stringify({ deviceId, platform: Platform.OS }),
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

  const loginWithMicrosoft = useCallback(
    async (code: string, state: string, redirectUri: string): Promise<{ success: boolean; error?: string }> => {
      try {
        let deviceId = await AsyncStorage.getItem(STORAGE_KEYS.DEVICE_ID);
        if (!deviceId) {
          deviceId = Crypto.randomUUID();
          await AsyncStorage.setItem(STORAGE_KEYS.DEVICE_ID, deviceId);
        }

        const domain = process.env["EXPO_PUBLIC_DOMAIN"];
        const baseUrl = domain ? `https://${domain}` : "";

        const resp = await fetch(`${baseUrl}/api/auth/microsoft/callback`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code, state, deviceId, platform: Platform.OS, redirectUri }),
        });

        const data = await resp.json() as {
          success?: boolean;
          token?: string;
          userId?: string;
          isAdmin?: boolean;
          microsoftEmail?: string;
          microsoftName?: string;
          error?: string;
        };

        if (!resp.ok || !data.success || !data.token || !data.userId) {
          return { success: false, error: data.error ?? "Microsoft login failed" };
        }

        await AsyncStorage.multiSet([
          [STORAGE_KEYS.TOKEN, data.token],
          [STORAGE_KEYS.USER_ID, data.userId],
          [STORAGE_KEYS.ONBOARDING_COMPLETE, "true"],
          [STORAGE_KEYS.IS_ADMIN, data.isAdmin ? "true" : "false"],
          [STORAGE_KEYS.ADMIN_EMAIL, data.microsoftEmail ?? ""],
        ]);

        setToken(data.token);
        setUserId(data.userId);
        setOnboardingComplete(true);
        setIsAdmin(!!data.isAdmin);
        setAdminEmail(data.microsoftEmail ?? null);
        setAuthTokenGetter(() => data.token!);

        return { success: true };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        return { success: false, error: msg };
      }
    },
    [],
  );

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
      STORAGE_KEYS.IS_ADMIN,
      STORAGE_KEYS.ADMIN_EMAIL,
    ]);
    setToken(null);
    setUserId(null);
    setActiveBusinessIdState(null);
    setOnboardingComplete(false);
    setIsAdmin(false);
    setAdminEmail(null);
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
        isAdmin,
        adminEmail,
        setActiveBusinessId,
        completeOnboarding,
        setTheme,
        logout,
        authenticate,
        loginWithRecovery,
        loginWithMicrosoft,
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
