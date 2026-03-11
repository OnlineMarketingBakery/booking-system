import { useState, useEffect } from "react";
import { useOrganization } from "@/hooks/useOrganization";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { useToast } from "@/hooks/use-toast";
import { Copy, Code, Palette, Loader2 } from "lucide-react";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { EmbedTheme } from "@/types/embedTheme";
import { DEFAULT_EMBED_THEME, buildFullThemeFromColors, parseRgbaOrHex } from "@/types/embedTheme";

function toHexForPicker(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  const m = /^#?([a-f\d]{6})/i.exec(value);
  return m ? "#" + m[1].toLowerCase() : fallback;
}

function parseTheme(embedTheme: Record<string, unknown> | null): Pick<EmbedTheme, "primaryColor" | "primaryColorOpacity" | "cardBackgroundColor" | "cardBackgroundColorOpacity" | "headingText" | "subheadingText" | "customCss"> {
  if (!embedTheme || typeof embedTheme !== "object") {
    return {
      primaryColor: DEFAULT_EMBED_THEME.primaryColor,
      primaryColorOpacity: 100,
      cardBackgroundColor: DEFAULT_EMBED_THEME.cardBackgroundColor,
      cardBackgroundColorOpacity: 100,
      headingText: DEFAULT_EMBED_THEME.headingText,
      subheadingText: DEFAULT_EMBED_THEME.subheadingText,
      customCss: "",
    };
  }
  const str = (k: string, d: string) => (typeof embedTheme[k] === "string" ? (embedTheme[k] as string) : d);
  const num = (k: string) => (typeof embedTheme[k] === "number" ? (embedTheme[k] as number) : undefined);
  return {
    primaryColor: str("primaryColor", DEFAULT_EMBED_THEME.primaryColor!),
    primaryColorOpacity: num("primaryColorOpacity") ?? 100,
    cardBackgroundColor: str("cardBackgroundColor", DEFAULT_EMBED_THEME.cardBackgroundColor!),
    cardBackgroundColorOpacity: num("cardBackgroundColorOpacity") ?? 100,
    headingText: str("headingText", DEFAULT_EMBED_THEME.headingText!),
    subheadingText: str("subheadingText", DEFAULT_EMBED_THEME.subheadingText!),
    customCss: typeof embedTheme.customCss === "string" ? embedTheme.customCss : "",
  };
}

export default function Embed() {
  const { organization } = useOrganization();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [theme, setTheme] = useState(() =>
    parseTheme(organization?.embed_theme ?? null)
  );

  useEffect(() => {
    setTheme(parseTheme(organization?.embed_theme ?? null));
  }, [organization?.embed_theme]);

  const embedUrl = `${window.location.origin}/book/${organization?.slug}`;
  const embedCode = `<iframe\n  src="${embedUrl}"\n  width="100%"\n  height="800"\n  frameborder="0"\n  style="border: none; border-radius: 12px;"\n></iframe>`;

  const copy = () => {
    navigator.clipboard.writeText(embedCode);
    toast({ title: "Copied!", description: "Embed code copied to clipboard." });
  };

  const saveTheme = useMutation({
    mutationFn: async (payload: EmbedTheme) => {
      if (!organization?.id) throw new Error("No organization");
      const { error } = await supabase
        .from("organizations")
        .update({ embed_theme: payload })
        .eq("id", organization.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["organization"] });
      toast({ title: "Saved", description: "Widget design updated." });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to save", description: err.message, variant: "destructive" });
    },
  });

  const handleSaveDesign = (e: React.FormEvent) => {
    e.preventDefault();
    saveTheme.mutate(
      buildFullThemeFromColors({
        primaryColor: theme.primaryColor ?? DEFAULT_EMBED_THEME.primaryColor!,
        primaryColorOpacity: theme.primaryColorOpacity ?? 100,
        cardBackgroundColor: theme.cardBackgroundColor ?? DEFAULT_EMBED_THEME.cardBackgroundColor!,
        cardBackgroundColorOpacity: theme.cardBackgroundColorOpacity ?? 100,
        headingText: theme.headingText,
        subheadingText: theme.subheadingText,
        customCss: theme.customCss,
      })
    );
  };

  const resetToDefaults = () => {
    setTheme({
      primaryColor: DEFAULT_EMBED_THEME.primaryColor,
      primaryColorOpacity: 100,
      cardBackgroundColor: DEFAULT_EMBED_THEME.cardBackgroundColor,
      cardBackgroundColorOpacity: 100,
      headingText: DEFAULT_EMBED_THEME.headingText,
      subheadingText: DEFAULT_EMBED_THEME.subheadingText,
      customCss: "",
    });
  };

  // Live preview URL with theme in query (debounced so iframe doesn't reload on every keystroke)
  const [previewUrl, setPreviewUrl] = useState(embedUrl);
  useEffect(() => {
    if (!organization?.slug) return;
    const base = `${window.location.origin}/book/${organization.slug}`;
    const fullTheme = buildFullThemeFromColors({
      primaryColor: theme.primaryColor ?? DEFAULT_EMBED_THEME.primaryColor!,
      primaryColorOpacity: theme.primaryColorOpacity ?? 100,
      cardBackgroundColor: theme.cardBackgroundColor ?? DEFAULT_EMBED_THEME.cardBackgroundColor!,
      cardBackgroundColorOpacity: theme.cardBackgroundColorOpacity ?? 100,
      headingText: theme.headingText,
      subheadingText: theme.subheadingText,
      customCss: theme.customCss,
    });
    const params = new URLSearchParams();
    params.set("preview_theme", JSON.stringify(fullTheme));
    const url = `${base}?${params.toString()}`;
    const t = setTimeout(() => setPreviewUrl(url), 400);
    return () => clearTimeout(t);
  }, [organization?.slug, theme]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Embed Booking</h1>
        <p className="text-muted-foreground">Add a booking widget to your website</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Palette className="h-5 w-5 text-primary" />
            Widget design
          </CardTitle>
          <CardDescription>
            Customize the color palette and text shown on your booking page. These apply when customers open your booking link or embed.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSaveDesign} className="space-y-6">
            <p className="text-sm text-muted-foreground">
              Set two colors; all other colors (text, buttons, borders, etc.) are derived automatically for contrast and consistency.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="primaryColor">Primary color</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="primaryColor"
                    type="color"
                    value={toHexForPicker(theme.primaryColor, DEFAULT_EMBED_THEME.primaryColor!)}
                    onChange={(e) => setTheme((t) => ({ ...t, primaryColor: e.target.value }))}
                    className="h-10 w-14 cursor-pointer rounded border p-1"
                  />
                  <Input
                    type="text"
                    value={theme.primaryColor ?? ""}
                    onChange={(e) => setTheme((t) => ({ ...t, primaryColor: e.target.value }))}
                    onBlur={(e) => {
                      const parsed = parseRgbaOrHex(e.target.value);
                      if (parsed) setTheme((t) => ({ ...t, primaryColor: parsed.hex, primaryColorOpacity: parsed.opacity }));
                    }}
                    placeholder="#3990F0"
                    className="font-mono text-sm flex-1"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Label className="text-xs text-muted-foreground">Opacity:</Label>
                  <Slider
                    value={[theme.primaryColorOpacity ?? 100]}
                    onValueChange={([v]) => setTheme((t) => ({ ...t, primaryColorOpacity: v }))}
                    min={0}
                    max={100}
                    className="flex-1 max-w-[120px]"
                  />
                  <span className="text-xs text-muted-foreground w-8">{theme.primaryColorOpacity ?? 100}%</span>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="cardBackgroundColor">Card background color</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="cardBackgroundColor"
                    type="color"
                    value={toHexForPicker(theme.cardBackgroundColor, DEFAULT_EMBED_THEME.cardBackgroundColor!)}
                    onChange={(e) => setTheme((t) => ({ ...t, cardBackgroundColor: e.target.value }))}
                    className="h-10 w-14 cursor-pointer rounded border p-1"
                  />
                  <Input
                    type="text"
                    value={theme.cardBackgroundColor ?? ""}
                    onChange={(e) => setTheme((t) => ({ ...t, cardBackgroundColor: e.target.value }))}
                    onBlur={(e) => { const p = parseRgbaOrHex(e.target.value); if (p) setTheme((t) => ({ ...t, cardBackgroundColor: p.hex, cardBackgroundColorOpacity: p.opacity })); }}
                    placeholder="#ffffff"
                    className="font-mono text-sm flex-1"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Label className="text-xs text-muted-foreground">Opacity:</Label>
                  <Slider value={[theme.cardBackgroundColorOpacity ?? 100]} onValueChange={([v]) => setTheme((t) => ({ ...t, cardBackgroundColorOpacity: v }))} min={0} max={100} className="flex-1 max-w-[120px]" />
                  <span className="text-xs text-muted-foreground w-8">{theme.cardBackgroundColorOpacity ?? 100}%</span>
                </div>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="headingText">Heading text</Label>
              <Input
                id="headingText"
                value={theme.headingText ?? ""}
                onChange={(e) => setTheme((t) => ({ ...t, headingText: e.target.value }))}
                placeholder="e.g. Book an appointment"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="subheadingText">Subheading text</Label>
              <Input
                id="subheadingText"
                value={theme.subheadingText ?? ""}
                onChange={(e) => setTheme((t) => ({ ...t, subheadingText: e.target.value }))}
                placeholder="e.g. Choose your service and time"
              />
            </div>
            <div className="space-y-3">
              <Label className="text-sm font-medium">Custom CSS (optional)</Label>
              <p className="text-xs text-muted-foreground">
                Scope to the widget with <code className="rounded bg-muted px-1 py-0.5 text-xs">.embed-booking-widget</code>.
              </p>
              <textarea
                value={theme.customCss ?? ""}
                onChange={(e) => setTheme((t) => ({ ...t, customCss: e.target.value }))}
                placeholder={".embed-booking-widget .embed-outline-btn { border-radius: 8px; }"}
                className="min-h-[100px] w-full rounded-md border bg-muted/30 px-3 py-2 font-mono text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                spellCheck={false}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={saveTheme.isPending}>
                {saveTheme.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save design
              </Button>
              <Button type="button" variant="outline" onClick={resetToDefaults}>
                Reset to defaults
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_1.4fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Code className="h-5 w-5 text-primary" />
              Embed Code
            </CardTitle>
            <CardDescription>Copy and paste this into your website's HTML.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <pre className="overflow-x-auto rounded-lg bg-muted p-4 text-sm">
              <code>{embedCode}</code>
            </pre>
            <Button onClick={copy} variant="outline">
              <Copy className="mr-2 h-4 w-4" />
              Copy Embed Code
            </Button>

            <div className="pt-4">
              <p className="text-sm font-medium">Direct Booking Link</p>
              <a href={embedUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-primary underline">
                {embedUrl}
              </a>
            </div>
          </CardContent>
        </Card>

        <Card className="flex flex-col">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Palette className="h-5 w-5 text-primary" />
              Live preview
            </CardTitle>
            <CardDescription>Real booking widget with your current colors and text. Updates as you change settings.</CardDescription>
          </CardHeader>
          <CardContent className="min-h-[640px] flex-1 p-0">
            <div className="h-full min-h-[600px] w-full overflow-hidden rounded-b-lg border-t">
              <iframe
                title="Booking widget preview"
                src={previewUrl}
                className="h-full min-h-[600px] w-full border-0"
                sandbox="allow-same-origin allow-scripts allow-forms"
              />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
