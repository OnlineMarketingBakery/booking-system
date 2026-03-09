import { useState, useEffect } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Loader2, CheckCircle2 } from "lucide-react";

export default function ConfirmPasswordChange() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");
  const { confirmPasswordChange, user } = useAuth();
  const { toast } = useToast();
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!token) {
      setStatus("error");
      setMessage("Invalid or missing confirmation link.");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        await confirmPasswordChange(token);
        if (!cancelled) {
          setStatus("success");
          setMessage("Your password has been changed. You can now sign in with your new password.");
          toast({ title: "Password changed", description: "You can sign in with your new password." });
        }
      } catch (err: any) {
        if (!cancelled) {
          setStatus("error");
          setMessage(err.message || "This link is invalid or has expired.");
          toast({ title: "Confirmation failed", description: err.message, variant: "destructive" });
        }
      }
    })();
    return () => { cancelled = true; };
  }, [token, confirmPasswordChange, toast]);

  if (user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6">
            <Button asChild className="w-full">
              <Link to="/dashboard">Go to dashboard</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {status === "loading" && <Loader2 className="h-5 w-5 animate-spin" />}
            {status === "success" && <CheckCircle2 className="h-5 w-5 text-green-600" />}
            {status === "loading" && "Confirming…"}
            {status === "success" && "Password changed"}
            {status === "error" && "Unable to confirm"}
          </CardTitle>
          <CardDescription>{message || (status === "loading" ? "Please wait." : "")}</CardDescription>
        </CardHeader>
        <CardContent>
          {(status === "success" || status === "error") && (
            <Button asChild className="w-full">
              <Link to="/">Sign in</Link>
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
