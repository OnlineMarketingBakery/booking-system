import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

type AppRole = "super_admin" | "salon_owner" | "staff" | "customer";

interface CustomUser {
  id: string;
  email: string;
  full_name: string | null;
  /** True when the user must set a new password in Settings (e.g. one-time password from admin provisioning). */
  must_change_password?: boolean;
}

interface AuthContextType {
  user: CustomUser | null;
  roles: AppRole[];
  loading: boolean;
  token: string | null;
  signUp: (
    email: string,
    password: string,
    fullName: string
  ) => Promise<{ pending?: boolean; must_change_password?: boolean } | void>;
  signIn: (email: string, password: string) => Promise<{ must_change_password?: boolean }>;
  signOut: () => Promise<void>;
  changePassword: (newPassword: string) => Promise<void>;
  requestPasswordReset: (email: string) => Promise<void>;
  setNewPassword: (resetToken: string, newPassword: string) => Promise<void>;
  confirmPasswordChange: (confirmToken: string) => Promise<void>;
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

    const u = { ...data.user, must_change_password: Boolean(data.user?.must_change_password) };
    storeAuth(data.token, u);
    setToken(data.token);
    setUser(u);
    await fetchRoles(u.id, data.token);
    return { must_change_password: u.must_change_password };
  };

  const signIn = async (email: string, password: string) => {
    const res = await fetch(FUNCTION_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "signin", email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Sign in failed");

    const u = { ...data.user, must_change_password: Boolean(data.user?.must_change_password) };
    storeAuth(data.token, u);
    setToken(data.token);
    setUser(u);
    await fetchRoles(u.id, data.token);
    return { must_change_password: u.must_change_password };
  };

  const signOut = async () => {
    clearAuth();
    setToken(null);
    setUser(null);
    setRoles([]);
  };

  const changePassword = async (newPassword: string) => {
    if (!token) throw new Error("You must be signed in to change your password");
    const res = await fetch(FUNCTION_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ action: "reset-password", newPassword }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Password change failed");
    const cleared = user ? { ...user, must_change_password: false } : null;
    if (cleared) {
      storeAuth(token, cleared);
      setUser(cleared);
    }
  };

  const requestPasswordReset = async (email: string) => {
    const res = await fetch(FUNCTION_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "request-password-reset", email: email.trim() }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const message = data?.error ?? (res.status === 429 ? "You can only request a password reset once per day. Please try again later." : "Request failed");
      throw new Error(message);
    }
    if (data?.error) throw new Error(data.error);
  };

  const setNewPassword = async (resetToken: string, newPassword: string) => {
    const { data, error } = await supabase.functions.invoke("auth-custom", {
      body: { action: "set-new-password", reset_token: resetToken, new_password: newPassword },
    });
    if (error) throw new Error(error.message || "Failed to set password");
    if (data?.error) throw new Error(data.error);
  };

  const confirmPasswordChange = async (confirmToken: string) => {
    const { data, error } = await supabase.functions.invoke("auth-custom", {
      body: { action: "confirm-password-change", confirm_token: confirmToken },
    });
    if (error) throw new Error(error.message || "Confirmation failed");
    if (data?.error) throw new Error(data.error);
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
    <AuthContext.Provider value={{ user, roles, loading, token, signUp, signIn, signOut, changePassword, requestPasswordReset, setNewPassword, confirmPasswordChange, hasRole, refreshRoles, invokeFunction }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
