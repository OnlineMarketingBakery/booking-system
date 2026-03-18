import { useEffect, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2 } from "lucide-react";

/**
 * Customer opens link from confirmation email to release a held slot without completing booking.
 */
export default function ReleaseHoldPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token")?.trim() ?? "";
  const [status, setStatus] = useState<"loading" | "done" | "error">("loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!token) {
      setStatus("error");
      setMessage("Geen geldige link. Gebruik de link uit je e-mail.");
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke("cancel-pending-booking-hold", {
          body: { token },
        });
        if (cancelled) return;
        if (error) {
          setStatus("error");
          setMessage(error.message || "Er ging iets mis. Probeer het later opnieuw.");
          return;
        }
        const d = data as { ok?: boolean; message?: string; error?: string };
        if (d?.error) {
          setStatus("error");
          setMessage(d.error);
          return;
        }
        setStatus("done");
        setMessage(
          d?.ok
            ? "De tijd is weer vrijgegeven. Je kunt een nieuwe afspraak boeken wanneer je wilt."
            : (d?.message ??
              "Deze reservering is niet meer actief (al bevestigd, geannuleerd of verlopen)."),
        );
      } catch {
        if (!cancelled) {
          setStatus("error");
          setMessage("Er ging iets mis. Probeer het later opnieuw.");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-muted/30">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Tijdsreservering</CardTitle>
          <CardDescription>
            {status === "loading" ? "Even geduld…" : null}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {status === "loading" && (
            <div className="flex justify-center py-6">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          )}
          {(status === "done" || status === "error") && (
            <p className={`text-sm ${status === "error" ? "text-destructive" : "text-muted-foreground"}`}>
              {message}
            </p>
          )}
          <Button variant="outline" className="w-full" asChild>
            <Link to="/">Naar start</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
