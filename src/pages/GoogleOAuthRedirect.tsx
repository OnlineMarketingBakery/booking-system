import { useEffect } from "react";

/**
 * This page runs when Google redirects back to your domain after the user connects their calendar.
 * It forwards the user to the Supabase Edge Function with the same query params (code, state)
 * so the function can exchange the code for tokens. The route is /auth/google-callback.
 * Register this full URL in Google Cloud OAuth client so Google shows your domain instead of the Supabase project ID.
 */
export default function GoogleOAuthRedirect() {
  useEffect(() => {
    const base = import.meta.env.VITE_SUPABASE_URL || "";
    const callback = `${base.replace(/\/$/, "")}/functions/v1/google-auth-callback`;
    const query = window.location.search;
    window.location.href = query ? `${callback}${query}` : callback;
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30">
      <p className="text-muted-foreground">Redirecting to complete Google Calendar connection…</p>
    </div>
  );
}
