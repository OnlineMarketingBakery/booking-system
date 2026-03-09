import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

type AppRole = "super_admin" | "salon_owner" | "staff" | "customer";

interface CustomUser {
  id: string;
  email: string;
  full_name: string | null;
}

interface AuthContextType {
  user: CustomUser | null;
  roles: AppRole[];
  loading: boolean;
  token: string | null;
  signUp: (email: string, password: string, fullName: string) => Promise<{ pending?: boolean } | void>;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  changePassword: (newPassword: string) => Promise<void>;
  hasRole: (role: AppRole) => boolean;
  refreshRoles: () => Promise<void>;
  invokeFunction: (name: string, body?: any) => Promise<any>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const AUTH_TOKEN_KEY = "custom_auth_token";
const AUTH_USER_KEY = "custom_auth_user";

function getStoredAuth(): { token: string | null; user: CustomUser | null } {
  try {
    const token = localStorage.getItem(AUTH_TOKEN_KEY);
    const userStr = localStorage.getItem(AUTH_USER_KEY);
    const user = userStr ? JSON.parse(userStr) : null;
    return { token, user };
  } catch {
    return { token: null, user: null };
  }
}

function storeAuth(token: string, user: CustomUser) {
  localStorage.setItem(AUTH_TOKEN_KEY, token);
  localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));
}

function clearAuth() {
  localStorage.removeItem(AUTH_TOKEN_KEY);
  localStorage.removeItem(AUTH_USER_KEY);
}

// Check if JWT is expired
function isTokenExpired(token: string): boolean {
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    return payload.exp * 1000 < Date.now();
  } catch {
    return true;
  }
}

const PROJECT_ID = import.meta.env.VITE_SUPABASE_PROJECT_ID || "pgcvqaexvnwwskdhooly";
const FUNCTION_URL = `https://${PROJECT_ID}.supabase.co/functions/v1/auth-custom`;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CustomUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchRoles = useCallback(async (userId: string, authToken: string) => {
    // Use supabase client with custom auth header
    const { data } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    if (data) {
      setRoles(data.map((r) => r.role as AppRole));
    }
  }, []);

  useEffect(() => {
    const { token: storedToken, user: storedUser } = getStoredAuth();
    if (storedToken && storedUser && !isTokenExpired(storedToken)) {
      setToken(storedToken);
      setUser(storedUser);
      fetchRoles(storedUser.id, storedToken);
    } else {
      clearAuth();
    }
    setLoading(false);
  }, [fetchRoles]);

  const signUp = async (email: string, password: string, fullName: string) => {
    const res = await fetch(FUNCTION_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "signup", email, password, fullName }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Sign up failed");

    if (data.pending) {
      return { pending: true };
    }

    storeAuth(data.token, data.user);
    setToken(data.token);
    setUser(data.user);
    await fetchRoles(data.user.id, data.token);
  };

  const signIn = async (email: string, password: string) => {
    const res = await fetch(FUNCTION_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "signin", email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Sign in failed");

    storeAuth(data.token, data.user);
    setToken(data.token);
    setUser(data.user);
    await fetchRoles(data.user.id, data.token);
  };

  const signOut = async () => {
    clearAuth();
    setToken(null);
    setUser(null);
    setRoles([]);
  };

  const changePassword = async (newPassword: string) => {
    if (!user?.email || !token) throw new Error("You must be signed in to change your password");
    const res = await fetch(FUNCTION_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ action: "reset-password", email: user.email, newPassword }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Password change failed");
  };

  const hasRole = (role: AppRole) => roles.includes(role);

  const refreshRoles = async () => {
    if (user && token) {
      await fetchRoles(user.id, token);
    }
  };

  const invokeFunction = async (name: string, body?: any) => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
    const { data, error } = await supabase.functions.invoke(name, {
      body,
      headers,
    });
    if (error) throw error;
    return data;
  };

  return (
    <AuthContext.Provider value={{ user, roles, loading, token, signUp, signIn, signOut, changePassword, hasRole, refreshRoles, invokeFunction }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
