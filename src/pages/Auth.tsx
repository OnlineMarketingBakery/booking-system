import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useSpamProtection } from "@/hooks/useSpamProtection";
import { SpamProtectionFields } from "@/components/SpamProtectionFields";
import { Loader2 } from "lucide-react";

export default function Auth() {
  const { signIn, signUp, user, requestPasswordReset } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);
  const { validateSpamProtection, SpamProtectionFieldsProps } = useSpamProtection();

  // Redirect if already logged in
  if (user) {
    navigate("/dashboard", { replace: true });
    return null;
  }

  const handleSignIn = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    if (!validateSpamProtection(form)) {
      toast({ title: "Please wait a moment", description: "Then try signing in again.", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      await signIn(form.get("email") as string, form.get("password") as string);
      navigate("/dashboard");
    } catch (err: any) {
      toast({ title: "Sign in failed", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleSignUp = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    if (!validateSpamProtection(form)) {
      toast({ title: "Please wait a moment", description: "Then try creating your account again.", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      const result = await signUp(
        form.get("email") as string,
        form.get("password") as string,
        form.get("fullName") as string
      );
      if (result && "pending" in result && result.pending) {
        toast({
          title: "Account created",
          description: "Your account is pending approval. You'll receive an email when an admin approves your request.",
        });
        return;
      }
      toast({ title: "Account created!", description: "You're now signed in." });
      navigate("/dashboard");
    } catch (err: any) {
      toast({ title: "Sign up failed", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    if (!validateSpamProtection(form)) {
      toast({ title: "Please wait a moment", description: "Then try again.", variant: "destructive" });
      return;
    }
    const email = (form.get("email") as string)?.trim();
    if (!email) {
      toast({ title: "Enter your email", variant: "destructive" });
      return;
    }
    setForgotLoading(true);
    try {
      await requestPasswordReset(email);
      setForgotSent(true);
      setForgotEmail(email);
      toast({ title: "Check your email", description: "If an account exists, we sent a reset link." });
    } catch (err: any) {
      toast({ title: "Something went wrong", description: err.message, variant: "destructive" });
    } finally {
      setForgotLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4">
      <div className="w-full max-w-md space-y-6">
        <div className="flex flex-col items-center gap-2">
          {/* <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Scissors className="h-6 w-6" />
          </div> */}
          <h1 className="text-2xl font-bold tracking-tight">Salonora</h1>
          <p className="text-sm text-muted-foreground">Salon booking made simple</p>
        </div>

        <Card>
          <Tabs defaultValue="signin">
            <CardHeader className="pb-4">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="signin">Sign In</TabsTrigger>
                <TabsTrigger value="signup">Sign Up</TabsTrigger>
              </TabsList>
            </CardHeader>

            <TabsContent value="signin">
              <form onSubmit={handleSignIn}>
                <CardContent className="space-y-4">
                  <SpamProtectionFields {...SpamProtectionFieldsProps} />
                  <div className="space-y-2">
                    <Label htmlFor="signin-email">Email</Label>
                    <Input id="signin-email" name="email" type="email" required placeholder="you@example.com" maxLength={255} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="signin-password">Password</Label>
                    <Input id="signin-password" name="password" type="password" required placeholder="••••••••" minLength={6} maxLength={128} />
                  </div>
                  <Button type="submit" className="w-full" disabled={loading}>
                    {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Sign In
                  </Button>
                  <p className="text-center">
                    <button
                      type="button"
                      className="text-sm text-primary hover:underline"
                      onClick={() => { setForgotSent(false); setForgotOpen(true); }}
                    >
                      Forgot password?
                    </button>
                  </p>
                </CardContent>
              </form>
            </TabsContent>

            <TabsContent value="signup">
              <form onSubmit={handleSignUp}>
                <CardContent className="space-y-4">
                  <SpamProtectionFields {...SpamProtectionFieldsProps} />
                  <div className="space-y-2">
                    <Label htmlFor="signup-name">Full Name</Label>
                    <Input id="signup-name" name="fullName" required placeholder="Jane Smith" maxLength={100} minLength={2} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="signup-email">Email</Label>
                    <Input id="signup-email" name="email" type="email" required placeholder="you@example.com" maxLength={255} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="signup-password">Password</Label>
                    <Input id="signup-password" name="password" type="password" required minLength={6} maxLength={128} placeholder="••••••••" />
                  </div>
                  <Button type="submit" className="w-full" disabled={loading}>
                    {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Create Account
                  </Button>
                  <p className="text-xs text-center text-muted-foreground">
                    By signing up, you agree to our Terms of Service.
                  </p>
                </CardContent>
              </form>
            </TabsContent>
          </Tabs>
        </Card>

        <Dialog open={forgotOpen} onOpenChange={(open) => { setForgotOpen(open); if (!open) setForgotSent(false); }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Forgot password</DialogTitle>
              <DialogDescription>
                Enter the email address for your account. We’ll send you a link to set a new password.
              </DialogDescription>
            </DialogHeader>
            {forgotSent ? (
              <p className="text-sm text-muted-foreground py-2">
                If an account exists for <strong>{forgotEmail}</strong>, we’ve sent a link to set a new password. Check your inbox and spam folder.
              </p>
            ) : (
              <form onSubmit={handleForgotPassword} className="space-y-4">
                <SpamProtectionFields {...SpamProtectionFieldsProps} />
                <div className="space-y-2">
                  <Label htmlFor="forgot-email">Email</Label>
                  <Input id="forgot-email" name="email" type="email" required placeholder="you@example.com" autoFocus />
                </div>
                <Button type="submit" className="w-full" disabled={forgotLoading}>
                  {forgotLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Send reset link
                </Button>
              </form>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
