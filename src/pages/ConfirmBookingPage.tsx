import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle2, AlertCircle } from "lucide-react";

export default function ConfirmBookingPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get("token");
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState<string>("");

  useEffect(() => {
    if (!token) {
      setStatus("error");
      setErrorMessage("Missing confirmation link.");
      return;
    }

    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke("confirm-booking-by-token", {
          body: { token },
        });
        if (error) throw new Error(error.message || "Confirmation failed");
        if (data?.error) throw new Error(data.error);

        if (data?.free && data?.booking_ids?.length > 0) {
          navigate(`/book/success?booking_id=${data.booking_ids[0]}`, { replace: true });
          return;
        }
        if (data?.url) {
          window.location.href = data.url;
          return;
        }
        setStatus("error");
        setErrorMessage("Invalid response from server.");
      } catch (e) {
        setStatus("error");
        setErrorMessage(e instanceof Error ? e.message : "Something went wrong.");
      }
    })();
  }, [token, navigate]);

  if (status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4">
        <Card className="w-full max-w-md text-center">
          <CardContent className="py-12 space-y-4">
            <Loader2 className="mx-auto h-12 w-12 animate-spin text-primary" />
            <p className="text-muted-foreground">Confirming your booking…</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4">
        <Card className="w-full max-w-md text-center">
          <CardContent className="py-12 space-y-4">
            <AlertCircle className="mx-auto h-16 w-16 text-destructive" />
            <h2 className="text-2xl font-bold">Confirmation failed</h2>
            <p className="text-muted-foreground">{errorMessage}</p>
            <Button variant="outline" onClick={() => window.history.back()}>
              Go back
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4">
      <Card className="w-full max-w-md text-center">
        <CardContent className="py-12 space-y-4">
          <CheckCircle2 className="mx-auto h-16 w-16 text-primary" />
          <h2 className="text-2xl font-bold">Booking confirmed</h2>
          <p className="text-muted-foreground">Redirecting…</p>
        </CardContent>
      </Card>
    </div>
  );
}
