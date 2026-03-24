import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useState, useEffect, createContext, useContext } from "react";
import { getToken, clearToken } from "@/lib/api";
import LoginPage from "@/pages/LoginPage";
import DashboardPage from "@/pages/DashboardPage";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient();

interface AuthContextValue {
  authenticated: boolean;
  login: () => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue>({
  authenticated: false,
  login: () => {},
  logout: () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

function PortalRoutes() {
  const { authenticated, login } = useAuth();

  if (authenticated) {
    return (
      <Switch>
        <Route path="/" component={DashboardPage} />
        <Route component={NotFound} />
      </Switch>
    );
  }

  return (
    <Switch>
      <Route path="/" component={() => <LoginPage onLogin={login} />} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  const [authenticated, setAuthenticated] = useState<boolean>(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setAuthenticated(!!getToken());
    setReady(true);
  }, []);

  function login() {
    setAuthenticated(true);
  }

  function logout() {
    clearToken();
    setAuthenticated(false);
  }

  if (!ready) return null;

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthContext.Provider value={{ authenticated, login, logout }}>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <PortalRoutes />
          </WouterRouter>
          <Toaster />
        </AuthContext.Provider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
