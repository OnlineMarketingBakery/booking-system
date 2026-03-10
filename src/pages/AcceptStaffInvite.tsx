import { useState, useEffect } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, CheckCircle2, XCircle, ThumbsDown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "https://pgcvqaexvnwwskdhooly.supabase.co";
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || "";

type InviteDetails = {
  org_name: string;
  expires_at: string | null;
  status: string;
  expired: boolean;
};

export default function AcceptStaffInvite() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");
  const [phase, setPhase] = useState<"loading" | "choose" | "success" | "error">("loading");
  const [details, setDetails] = useState<InviteDetails | null>(null);
  const [message, setMessage] = useState("");
  const [actionLoading, setActionLoading] = useState(false);

  useEffect(() => {
    if (!token) {
      setPhase("error");
      setMessage("Invalid or missing invitation link.");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `${SUPABASE_URL}/functions/v1/accept-staff-invite?token=${encodeURIComponent(token)}`,
          { headers: { Authorization: `Bearer ${SUPABASE_ANON_KEY}` } }
        );
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setPhase("error");
          setMessage(data?.error || "Invitation not found or invalid.");
          return;
        }
        if (data.expired) {
          setPhase("error");
          setMessage("This invitation has expired.");
          return;
        }
        if (data.status && data.status !== "pending") {
          setPhase("success");
          setMessage(data.status === "accepted"
            ? "You had already accepted this invitation."
            : "You had already declined this invitation.");
          return;
        }
        setDetails({
          org_name: data.org_name || "the team",
          expires_at: data.expires_at || null,
          status: data.status || "pending",
          expired: data.expired || false,
        });
        setPhase("choose");
      } catch (err) {
        if (!cancelled) {
          setPhase("error");
          setMessage(err instanceof Error ? err.message : "Something went wrong.");
        }
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  const runAction = async (action: "accept" | "reject") => {
    if (!token) return;
    setActionLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("accept-staff-invite", {
        body: { token, action },
      });
      if (error) throw new Error(error.message || "Request failed");
      if (data?.error) throw new Error(data.error);
      setPhase("success");
      setMessage(action === "accept"
        ? "You've accepted the invitation. The salon owner can now add you to the team."
        : "You've declined the invitation.");
    } catch (err) {
      setPhase("error");
      setMessage(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setActionLoading(false);
    }
  };

  const expiresStr = details?.expires_at
    ? new Date(details.expires_at).toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })
    : null;

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {phase === "loading" && <Loader2 className="h-5 w-5 animate-spin" />}
            {phase === "success" && !message.includes("declined") && <CheckCircle2 className="h-5 w-5 text-green-600" />}
            {phase === "success" && message.includes("declined") && <ThumbsDown className="h-5 w-5 text-muted-foreground" />}
            {phase === "error" && <XCircle className="h-5 w-5 text-destructive" />}
            {phase === "loading" && "Loading…"}
            {phase === "choose" && "Staff invitation"}
            {phase === "success" && (message.includes("accepted") ? "Invitation accepted" : "Invitation declined")}
            {phase === "error" && "Unable to continue"}
          </CardTitle>
          <CardDescription>
            {phase === "loading" && "Please wait."}
            {phase === "choose" && details && (
              <>
                You've been invited to join <strong>{details.org_name}</strong> as staff.
                {expiresStr && (
                  <span className="block mt-2 text-muted-foreground">This invitation expires on {expiresStr}.</span>
                )}
              </>
            )}
            {phase === "success" && message}
            {phase === "error" && message}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {phase === "choose" && (
            <>
              <div className="flex gap-2">
                <Button
                  className="flex-1"
                  disabled={actionLoading}
                  onClick={() => runAction("accept")}
                >
                  {actionLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Accept
                </Button>
                <Button
                  variant="outline"
                  className="flex-1"
                  disabled={actionLoading}
                  onClick={() => runAction("reject")}
                >
                  Reject
                </Button>
              </div>
            </>
          )}
          {(phase === "success" || phase === "error") && (
            <Button asChild className="w-full">
              <Link to="/">Go to sign in</Link>
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
