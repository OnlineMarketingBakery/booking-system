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
import { DEFAULT_EMBED_THEME, parseRgbaOrHex } from "@/types/embedTheme";

function toHexForPicker(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  const m = /^#?([a-f\d]{6})/i.exec(value);
  return m ? "#" + m[1].toLowerCase() : fallback;
}

function parseTheme(embedTheme: Record<string, unknown> | null): EmbedTheme {
  if (!embedTheme || typeof embedTheme !== "object") return { ...DEFAULT_EMBED_THEME };
  const num = (k: string) => (typeof embedTheme[k] === "number" ? (embedTheme[k] as number) : undefined);
  const str = (k: string, d: string) => (typeof embedTheme[k] === "string" ? (embedTheme[k] as string) : d);
  return {
    primaryColor: str("primaryColor", DEFAULT_EMBED_THEME.primaryColor!),
    primaryColorOpacity: num("primaryColorOpacity"),
    primaryForegroundColor: str("primaryForegroundColor", DEFAULT_EMBED_THEME.primaryForegroundColor!),
    primaryForegroundColorOpacity: num("primaryForegroundColorOpacity"),
    backgroundColor: str("backgroundColor", DEFAULT_EMBED_THEME.backgroundColor!),
    backgroundColorOpacity: num("backgroundColorOpacity"),
    cardBackgroundColor: str("cardBackgroundColor", DEFAULT_EMBED_THEME.cardBackgroundColor!),
    cardBackgroundColorOpacity: num("cardBackgroundColorOpacity"),
    headingColor: str("headingColor", DEFAULT_EMBED_THEME.headingColor!),
    headingColorOpacity: num("headingColorOpacity"),
    bodyTextColor: str("bodyTextColor", (embedTheme.textColor as string) || DEFAULT_EMBED_THEME.bodyTextColor!),
    bodyTextColorOpacity: num("bodyTextColorOpacity"),
    mutedTextColor: str("mutedTextColor", DEFAULT_EMBED_THEME.mutedTextColor!),
    mutedTextColorOpacity: num("mutedTextColorOpacity"),
    cardBorderColor: str("cardBorderColor", DEFAULT_EMBED_THEME.cardBorderColor!),
    cardBorderColorOpacity: num("cardBorderColorOpacity"),
    cardBorderWidth: typeof embedTheme.cardBorderWidth === "number" ? embedTheme.cardBorderWidth : DEFAULT_EMBED_THEME.cardBorderWidth,
    buttonBackgroundColor: str("buttonBackgroundColor", DEFAULT_EMBED_THEME.buttonBackgroundColor!),
    buttonTextColor: str("buttonTextColor", DEFAULT_EMBED_THEME.buttonTextColor!),
    buttonBorderColor: str("buttonBorderColor", DEFAULT_EMBED_THEME.buttonBorderColor!),
    buttonHoverBackgroundColor: str("buttonHoverBackgroundColor", DEFAULT_EMBED_THEME.buttonHoverBackgroundColor!),
    buttonHoverTextColor: str("buttonHoverTextColor", DEFAULT_EMBED_THEME.buttonHoverTextColor!),
    buttonActiveBackgroundColor: str("buttonActiveBackgroundColor", DEFAULT_EMBED_THEME.buttonActiveBackgroundColor!),
    buttonActiveTextColor: str("buttonActiveTextColor", DEFAULT_EMBED_THEME.buttonActiveTextColor!),
    buttonFocusRingColor: str("buttonFocusRingColor", DEFAULT_EMBED_THEME.buttonFocusRingColor!),
    inputBackgroundColor: str("inputBackgroundColor", DEFAULT_EMBED_THEME.inputBackgroundColor!),
    inputTextColor: str("inputTextColor", DEFAULT_EMBED_THEME.inputTextColor!),
    inputBorderColor: str("inputBorderColor", DEFAULT_EMBED_THEME.inputBorderColor!),
    inputPlaceholderColor: str("inputPlaceholderColor", DEFAULT_EMBED_THEME.inputPlaceholderColor!),
    summaryBackgroundColor: str("summaryBackgroundColor", DEFAULT_EMBED_THEME.summaryBackgroundColor!),
    summaryTitleColor: str("summaryTitleColor", DEFAULT_EMBED_THEME.summaryTitleColor!),
    summaryTextColor: str("summaryTextColor", DEFAULT_EMBED_THEME.summaryTextColor!),
    summaryBorderColor: str("summaryBorderColor", DEFAULT_EMBED_THEME.summaryBorderColor!),
    summarySeparatorColor: str("summarySeparatorColor", DEFAULT_EMBED_THEME.summarySeparatorColor!),
    customCss: typeof embedTheme.customCss === "string" ? embedTheme.customCss : "",
    stepPillCompletedColor: str("stepPillCompletedColor", DEFAULT_EMBED_THEME.stepPillCompletedColor!),
    stepPillCurrentColor: str("stepPillCurrentColor", DEFAULT_EMBED_THEME.stepPillCurrentColor!),
    stepPillDefaultColor: str("stepPillDefaultColor", DEFAULT_EMBED_THEME.stepPillDefaultColor!),
    textColor: str("textColor", DEFAULT_EMBED_THEME.textColor!),
    headingText: str("headingText", DEFAULT_EMBED_THEME.headingText!),
    subheadingText: str("subheadingText", DEFAULT_EMBED_THEME.subheadingText!),
  };
}

export default function Embed() {
  const { organization } = useOrganization();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [theme, setTheme] = useState<EmbedTheme>(() =>
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
    saveTheme.mutate(theme);
  };

  const resetToDefaults = () => {
    setTheme({ ...DEFAULT_EMBED_THEME });
  };

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
                    placeholder="#7c3aed or rgba(124,58,237,0.8)"
                    className="font-mono text-sm flex-1"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Label className="text-xs text-muted-foreground">Opacity (RGBA):</Label>
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
                <Label htmlFor="primaryForegroundColor">Primary text color</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="primaryForegroundColor"
                    type="color"
                    value={toHexForPicker(theme.primaryForegroundColor, DEFAULT_EMBED_THEME.primaryForegroundColor!)}
                    onChange={(e) => setTheme((t) => ({ ...t, primaryForegroundColor: e.target.value }))}
                    className="h-10 w-14 cursor-pointer rounded border p-1"
                  />
                  <Input
                    type="text"
                    value={theme.primaryForegroundColor ?? ""}
                    onChange={(e) => setTheme((t) => ({ ...t, primaryForegroundColor: e.target.value }))}
                    onBlur={(e) => {
                      const parsed = parseRgbaOrHex(e.target.value);
                      if (parsed) setTheme((t) => ({ ...t, primaryForegroundColor: parsed.hex, primaryForegroundColorOpacity: parsed.opacity }));
                    }}
                    placeholder="#ffffff or rgba(255,255,255,0.9)"
                    className="font-mono text-sm flex-1"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Label className="text-xs text-muted-foreground">Opacity:</Label>
                  <Slider value={[theme.primaryForegroundColorOpacity ?? 100]} onValueChange={([v]) => setTheme((t) => ({ ...t, primaryForegroundColorOpacity: v }))} min={0} max={100} className="flex-1 max-w-[120px]" />
                  <span className="text-xs text-muted-foreground w-8">{theme.primaryForegroundColorOpacity ?? 100}%</span>
                </div>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="backgroundColor">Background color</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="backgroundColor"
                  type="color"
                  value={toHexForPicker(theme.backgroundColor, DEFAULT_EMBED_THEME.backgroundColor!)}
                  onChange={(e) => setTheme((t) => ({ ...t, backgroundColor: e.target.value }))}
                  className="h-10 w-14 cursor-pointer rounded border p-1"
                />
                <Input
                  type="text"
                  value={theme.backgroundColor ?? ""}
                  onChange={(e) => setTheme((t) => ({ ...t, backgroundColor: e.target.value }))}
                  onBlur={(e) => { const p = parseRgbaOrHex(e.target.value); if (p) setTheme((t) => ({ ...t, backgroundColor: p.hex, backgroundColorOpacity: p.opacity })); }}
                  placeholder="#f5f5f5 or rgba(245,245,245,0.95)"
                  className="font-mono text-sm flex-1"
                />
              </div>
              <div className="flex items-center gap-2">
                <Label className="text-xs text-muted-foreground">Opacity (RGBA):</Label>
                <Slider value={[theme.backgroundColorOpacity ?? 100]} onValueChange={([v]) => setTheme((t) => ({ ...t, backgroundColorOpacity: v }))} min={0} max={100} className="flex-1 max-w-[120px]" />
                <span className="text-xs text-muted-foreground w-8">{theme.backgroundColorOpacity ?? 100}%</span>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="textColor">Body text color</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="textColor"
                  type="color"
                  value={toHexForPicker(theme.bodyTextColor ?? theme.textColor, DEFAULT_EMBED_THEME.bodyTextColor!)}
                  onChange={(e) => setTheme((t) => ({ ...t, bodyTextColor: e.target.value, textColor: e.target.value }))}
                  className="h-10 w-14 cursor-pointer rounded border p-1"
                />
                <Input
                  type="text"
                  value={theme.bodyTextColor ?? theme.textColor ?? ""}
                  onChange={(e) => setTheme((t) => ({ ...t, bodyTextColor: e.target.value, textColor: e.target.value }))}
                  onBlur={(e) => { const p = parseRgbaOrHex(e.target.value); if (p) setTheme((t) => ({ ...t, bodyTextColor: p.hex, textColor: p.hex, bodyTextColorOpacity: p.opacity })); }}
                  placeholder="#1f2937 or rgba(31,41,55,0.9)"
                  className="font-mono text-sm flex-1"
                />
              </div>
              <div className="flex items-center gap-2">
                <Label className="text-xs text-muted-foreground">Opacity:</Label>
                <Slider value={[theme.bodyTextColorOpacity ?? 100]} onValueChange={([v]) => setTheme((t) => ({ ...t, bodyTextColorOpacity: v }))} min={0} max={100} className="flex-1 max-w-[120px]" />
                <span className="text-xs text-muted-foreground w-8">{theme.bodyTextColorOpacity ?? 100}%</span>
              </div>
              <p className="text-xs text-muted-foreground">General body text</p>
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
                  placeholder="#ffffff or rgba(255,255,255,0.98)"
                  className="font-mono text-sm flex-1"
                />
              </div>
              <div className="flex items-center gap-2">
                <Label className="text-xs text-muted-foreground">Opacity (RGBA):</Label>
                <Slider value={[theme.cardBackgroundColorOpacity ?? 100]} onValueChange={([v]) => setTheme((t) => ({ ...t, cardBackgroundColorOpacity: v }))} min={0} max={100} className="flex-1 max-w-[120px]" />
                <span className="text-xs text-muted-foreground w-8">{theme.cardBackgroundColorOpacity ?? 100}%</span>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="headingColor">Heading color</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="headingColor"
                  type="color"
                  value={toHexForPicker(theme.headingColor, DEFAULT_EMBED_THEME.headingColor!)}
                  onChange={(e) => setTheme((t) => ({ ...t, headingColor: e.target.value }))}
                  className="h-10 w-14 cursor-pointer rounded border p-1"
                />
                <Input
                  type="text"
                  value={theme.headingColor ?? ""}
                  onChange={(e) => setTheme((t) => ({ ...t, headingColor: e.target.value }))}
                  onBlur={(e) => { const p = parseRgbaOrHex(e.target.value); if (p) setTheme((t) => ({ ...t, headingColor: p.hex, headingColorOpacity: p.opacity })); }}
                  placeholder="#111827 or rgba(17,24,39,0.9)"
                  className="font-mono text-sm flex-1"
                />
              </div>
              <div className="flex items-center gap-2">
                <Label className="text-xs text-muted-foreground">Opacity:</Label>
                <Slider value={[theme.headingColorOpacity ?? 100]} onValueChange={([v]) => setTheme((t) => ({ ...t, headingColorOpacity: v }))} min={0} max={100} className="flex-1 max-w-[120px]" />
                <span className="text-xs text-muted-foreground w-8">{theme.headingColorOpacity ?? 100}%</span>
              </div>
              <p className="text-xs text-muted-foreground">Card titles and main headings</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="mutedTextColor">Muted / secondary text color</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="mutedTextColor"
                  type="color"
                  value={toHexForPicker(theme.mutedTextColor, DEFAULT_EMBED_THEME.mutedTextColor!)}
                  onChange={(e) => setTheme((t) => ({ ...t, mutedTextColor: e.target.value }))}
                  className="h-10 w-14 cursor-pointer rounded border p-1"
                />
                <Input
                  type="text"
                  value={theme.mutedTextColor ?? ""}
                  onChange={(e) => setTheme((t) => ({ ...t, mutedTextColor: e.target.value }))}
                  onBlur={(e) => { const p = parseRgbaOrHex(e.target.value); if (p) setTheme((t) => ({ ...t, mutedTextColor: p.hex, mutedTextColorOpacity: p.opacity })); }}
                  placeholder="#6b7280 or rgba(107,114,128,0.8)"
                  className="font-mono text-sm flex-1"
                />
              </div>
              <div className="flex items-center gap-2">
                <Label className="text-xs text-muted-foreground">Opacity:</Label>
                <Slider value={[theme.mutedTextColorOpacity ?? 100]} onValueChange={([v]) => setTheme((t) => ({ ...t, mutedTextColorOpacity: v }))} min={0} max={100} className="flex-1 max-w-[120px]" />
                <span className="text-xs text-muted-foreground w-8">{theme.mutedTextColorOpacity ?? 100}%</span>
              </div>
              <p className="text-xs text-muted-foreground">Descriptions and secondary text</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="cardBorderColor">Card border color</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="cardBorderColor"
                    type="color"
                    value={toHexForPicker(theme.cardBorderColor, DEFAULT_EMBED_THEME.cardBorderColor!)}
                    onChange={(e) => setTheme((t) => ({ ...t, cardBorderColor: e.target.value }))}
                    className="h-10 w-14 cursor-pointer rounded border p-1"
                  />
                  <Input
                    type="text"
                    value={theme.cardBorderColor ?? ""}
                    onChange={(e) => setTheme((t) => ({ ...t, cardBorderColor: e.target.value }))}
                    onBlur={(e) => { const p = parseRgbaOrHex(e.target.value); if (p) setTheme((t) => ({ ...t, cardBorderColor: p.hex, cardBorderColorOpacity: p.opacity })); }}
                    placeholder="#e5e7eb or rgba(229,231,235,0.8)"
                    className="font-mono text-sm flex-1"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Label className="text-xs text-muted-foreground">Opacity (RGBA):</Label>
                  <Slider value={[theme.cardBorderColorOpacity ?? 100]} onValueChange={([v]) => setTheme((t) => ({ ...t, cardBorderColorOpacity: v }))} min={0} max={100} className="flex-1 max-w-[120px]" />
                  <span className="text-xs text-muted-foreground w-8">{theme.cardBorderColorOpacity ?? 100}%</span>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="cardBorderWidth">Card border width (px)</Label>
                <Input
                  id="cardBorderWidth"
                  type="number"
                  min={0}
                  max={20}
                  value={theme.cardBorderWidth ?? DEFAULT_EMBED_THEME.cardBorderWidth ?? 1}
                  onChange={(e) => setTheme((t) => ({ ...t, cardBorderWidth: e.target.value ? parseInt(e.target.value, 10) : undefined }))}
                  placeholder="1"
                />
              </div>
            </div>
            <div className="space-y-3">
              <Label className="text-sm font-medium">Outline button (e.g. location / staff selector)</Label>
              <p className="text-xs text-muted-foreground">Background, text, hover, active, and focus ring for unselected option buttons.</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label className="text-xs">Background</Label>
                  <div className="flex items-center gap-2">
                    <Input type="color" value={toHexForPicker(theme.buttonBackgroundColor, DEFAULT_EMBED_THEME.buttonBackgroundColor!)} onChange={(e) => setTheme((t) => ({ ...t, buttonBackgroundColor: e.target.value }))} className="h-9 w-12 cursor-pointer rounded border p-1" />
                    <Input type="text" value={theme.buttonBackgroundColor ?? ""} onChange={(e) => setTheme((t) => ({ ...t, buttonBackgroundColor: e.target.value }))} placeholder="#ffffff" className="font-mono text-xs flex-1" />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Text color</Label>
                  <div className="flex items-center gap-2">
                    <Input type="color" value={toHexForPicker(theme.buttonTextColor, DEFAULT_EMBED_THEME.buttonTextColor!)} onChange={(e) => setTheme((t) => ({ ...t, buttonTextColor: e.target.value }))} className="h-9 w-12 cursor-pointer rounded border p-1" />
                    <Input type="text" value={theme.buttonTextColor ?? ""} onChange={(e) => setTheme((t) => ({ ...t, buttonTextColor: e.target.value }))} placeholder="#1f2937" className="font-mono text-xs flex-1" />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Border color</Label>
                  <div className="flex items-center gap-2">
                    <Input type="color" value={toHexForPicker(theme.buttonBorderColor, DEFAULT_EMBED_THEME.buttonBorderColor!)} onChange={(e) => setTheme((t) => ({ ...t, buttonBorderColor: e.target.value }))} className="h-9 w-12 cursor-pointer rounded border p-1" />
                    <Input type="text" value={theme.buttonBorderColor ?? ""} onChange={(e) => setTheme((t) => ({ ...t, buttonBorderColor: e.target.value }))} placeholder="#e5e7eb" className="font-mono text-xs flex-1" />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Hover background</Label>
                  <div className="flex items-center gap-2">
                    <Input type="color" value={toHexForPicker(theme.buttonHoverBackgroundColor, DEFAULT_EMBED_THEME.buttonHoverBackgroundColor!)} onChange={(e) => setTheme((t) => ({ ...t, buttonHoverBackgroundColor: e.target.value }))} className="h-9 w-12 cursor-pointer rounded border p-1" />
                    <Input type="text" value={theme.buttonHoverBackgroundColor ?? ""} onChange={(e) => setTheme((t) => ({ ...t, buttonHoverBackgroundColor: e.target.value }))} placeholder="#f3f4f6" className="font-mono text-xs flex-1" />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Hover text</Label>
                  <div className="flex items-center gap-2">
                    <Input type="color" value={toHexForPicker(theme.buttonHoverTextColor, DEFAULT_EMBED_THEME.buttonHoverTextColor!)} onChange={(e) => setTheme((t) => ({ ...t, buttonHoverTextColor: e.target.value }))} className="h-9 w-12 cursor-pointer rounded border p-1" />
                    <Input type="text" value={theme.buttonHoverTextColor ?? ""} onChange={(e) => setTheme((t) => ({ ...t, buttonHoverTextColor: e.target.value }))} placeholder="#111827" className="font-mono text-xs flex-1" />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Active background</Label>
                  <div className="flex items-center gap-2">
                    <Input type="color" value={toHexForPicker(theme.buttonActiveBackgroundColor, DEFAULT_EMBED_THEME.buttonActiveBackgroundColor!)} onChange={(e) => setTheme((t) => ({ ...t, buttonActiveBackgroundColor: e.target.value }))} className="h-9 w-12 cursor-pointer rounded border p-1" />
                    <Input type="text" value={theme.buttonActiveBackgroundColor ?? ""} onChange={(e) => setTheme((t) => ({ ...t, buttonActiveBackgroundColor: e.target.value }))} placeholder="#e5e7eb" className="font-mono text-xs flex-1" />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Active text</Label>
                  <div className="flex items-center gap-2">
                    <Input type="color" value={toHexForPicker(theme.buttonActiveTextColor, DEFAULT_EMBED_THEME.buttonActiveTextColor!)} onChange={(e) => setTheme((t) => ({ ...t, buttonActiveTextColor: e.target.value }))} className="h-9 w-12 cursor-pointer rounded border p-1" />
                    <Input type="text" value={theme.buttonActiveTextColor ?? ""} onChange={(e) => setTheme((t) => ({ ...t, buttonActiveTextColor: e.target.value }))} placeholder="#111827" className="font-mono text-xs flex-1" />
                  </div>
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <Label className="text-xs">Focus ring color</Label>
                  <div className="flex items-center gap-2">
                    <Input type="color" value={toHexForPicker(theme.buttonFocusRingColor, DEFAULT_EMBED_THEME.buttonFocusRingColor!)} onChange={(e) => setTheme((t) => ({ ...t, buttonFocusRingColor: e.target.value }))} className="h-9 w-12 cursor-pointer rounded border p-1" />
                    <Input type="text" value={theme.buttonFocusRingColor ?? ""} onChange={(e) => setTheme((t) => ({ ...t, buttonFocusRingColor: e.target.value }))} placeholder="#7c3aed" className="font-mono text-xs flex-1" />
                  </div>
                </div>
              </div>
            </div>
            <div className="space-y-3">
              <Label className="text-sm font-medium">Form input fields (Name, Email, Phone)</Label>
              <p className="text-xs text-muted-foreground">Background, text, border, and placeholder for the booking form inputs.</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label className="text-xs">Background</Label>
                  <div className="flex items-center gap-2">
                    <Input type="color" value={toHexForPicker(theme.inputBackgroundColor, DEFAULT_EMBED_THEME.inputBackgroundColor!)} onChange={(e) => setTheme((t) => ({ ...t, inputBackgroundColor: e.target.value }))} className="h-9 w-12 cursor-pointer rounded border p-1" />
                    <Input type="text" value={theme.inputBackgroundColor ?? ""} onChange={(e) => setTheme((t) => ({ ...t, inputBackgroundColor: e.target.value }))} placeholder="#ffffff" className="font-mono text-xs flex-1" />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Text color</Label>
                  <div className="flex items-center gap-2">
                    <Input type="color" value={toHexForPicker(theme.inputTextColor, DEFAULT_EMBED_THEME.inputTextColor!)} onChange={(e) => setTheme((t) => ({ ...t, inputTextColor: e.target.value }))} className="h-9 w-12 cursor-pointer rounded border p-1" />
                    <Input type="text" value={theme.inputTextColor ?? ""} onChange={(e) => setTheme((t) => ({ ...t, inputTextColor: e.target.value }))} placeholder="#1f2937" className="font-mono text-xs flex-1" />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Border color</Label>
                  <div className="flex items-center gap-2">
                    <Input type="color" value={toHexForPicker(theme.inputBorderColor, DEFAULT_EMBED_THEME.inputBorderColor!)} onChange={(e) => setTheme((t) => ({ ...t, inputBorderColor: e.target.value }))} className="h-9 w-12 cursor-pointer rounded border p-1" />
                    <Input type="text" value={theme.inputBorderColor ?? ""} onChange={(e) => setTheme((t) => ({ ...t, inputBorderColor: e.target.value }))} placeholder="#e5e7eb" className="font-mono text-xs flex-1" />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Placeholder text color</Label>
                  <div className="flex items-center gap-2">
                    <Input type="color" value={toHexForPicker(theme.inputPlaceholderColor, DEFAULT_EMBED_THEME.inputPlaceholderColor!)} onChange={(e) => setTheme((t) => ({ ...t, inputPlaceholderColor: e.target.value }))} className="h-9 w-12 cursor-pointer rounded border p-1" />
                    <Input type="text" value={theme.inputPlaceholderColor ?? ""} onChange={(e) => setTheme((t) => ({ ...t, inputPlaceholderColor: e.target.value }))} placeholder="#9ca3af" className="font-mono text-xs flex-1" />
                  </div>
                </div>
              </div>
            </div>
            <div className="space-y-3">
              <Label className="text-sm font-medium">Booking Summary panel</Label>
              <p className="text-xs text-muted-foreground">Background, title, text, border, and separator line for the summary box.</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label className="text-xs">Background</Label>
                  <div className="flex items-center gap-2">
                    <Input type="color" value={toHexForPicker(theme.summaryBackgroundColor, DEFAULT_EMBED_THEME.summaryBackgroundColor!)} onChange={(e) => setTheme((t) => ({ ...t, summaryBackgroundColor: e.target.value }))} className="h-9 w-12 cursor-pointer rounded border p-1" />
                    <Input type="text" value={theme.summaryBackgroundColor ?? ""} onChange={(e) => setTheme((t) => ({ ...t, summaryBackgroundColor: e.target.value }))} placeholder="#f9fafb" className="font-mono text-xs flex-1" />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Title color (&quot;Booking Summary&quot;)</Label>
                  <div className="flex items-center gap-2">
                    <Input type="color" value={toHexForPicker(theme.summaryTitleColor, DEFAULT_EMBED_THEME.summaryTitleColor!)} onChange={(e) => setTheme((t) => ({ ...t, summaryTitleColor: e.target.value }))} className="h-9 w-12 cursor-pointer rounded border p-1" />
                    <Input type="text" value={theme.summaryTitleColor ?? ""} onChange={(e) => setTheme((t) => ({ ...t, summaryTitleColor: e.target.value }))} placeholder="#6b7280" className="font-mono text-xs flex-1" />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Text color (services & total)</Label>
                  <div className="flex items-center gap-2">
                    <Input type="color" value={toHexForPicker(theme.summaryTextColor, DEFAULT_EMBED_THEME.summaryTextColor!)} onChange={(e) => setTheme((t) => ({ ...t, summaryTextColor: e.target.value }))} className="h-9 w-12 cursor-pointer rounded border p-1" />
                    <Input type="text" value={theme.summaryTextColor ?? ""} onChange={(e) => setTheme((t) => ({ ...t, summaryTextColor: e.target.value }))} placeholder="#1f2937" className="font-mono text-xs flex-1" />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Border color</Label>
                  <div className="flex items-center gap-2">
                    <Input type="color" value={toHexForPicker(theme.summaryBorderColor, DEFAULT_EMBED_THEME.summaryBorderColor!)} onChange={(e) => setTheme((t) => ({ ...t, summaryBorderColor: e.target.value }))} className="h-9 w-12 cursor-pointer rounded border p-1" />
                    <Input type="text" value={theme.summaryBorderColor ?? ""} onChange={(e) => setTheme((t) => ({ ...t, summaryBorderColor: e.target.value }))} placeholder="#e5e7eb" className="font-mono text-xs flex-1" />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Separator line color (above Total)</Label>
                  <div className="flex items-center gap-2">
                    <Input type="color" value={toHexForPicker(theme.summarySeparatorColor, DEFAULT_EMBED_THEME.summarySeparatorColor!)} onChange={(e) => setTheme((t) => ({ ...t, summarySeparatorColor: e.target.value }))} className="h-9 w-12 cursor-pointer rounded border p-1" />
                    <Input type="text" value={theme.summarySeparatorColor ?? ""} onChange={(e) => setTheme((t) => ({ ...t, summarySeparatorColor: e.target.value }))} placeholder="#e5e7eb" className="font-mono text-xs flex-1" />
                  </div>
                </div>
              </div>
            </div>
            <div className="space-y-3">
              <Label className="text-sm font-medium">Step progress pills</Label>
              <p className="text-xs text-muted-foreground">Colors for the progress indicator above the card (completed steps, current step, and not-yet-reached steps).</p>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1">
                  <Label className="text-xs">Completed (past steps)</Label>
                  <div className="flex items-center gap-2">
                    <Input type="color" value={toHexForPicker(theme.stepPillCompletedColor, DEFAULT_EMBED_THEME.stepPillCompletedColor!)} onChange={(e) => setTheme((t) => ({ ...t, stepPillCompletedColor: e.target.value }))} className="h-9 w-12 cursor-pointer rounded border p-1" />
                    <Input type="text" value={theme.stepPillCompletedColor ?? ""} onChange={(e) => setTheme((t) => ({ ...t, stepPillCompletedColor: e.target.value }))} placeholder="#7c3aed" className="font-mono text-xs flex-1" />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Current step (active pill)</Label>
                  <div className="flex items-center gap-2">
                    <Input type="color" value={toHexForPicker(theme.stepPillCurrentColor, DEFAULT_EMBED_THEME.stepPillCurrentColor!)} onChange={(e) => setTheme((t) => ({ ...t, stepPillCurrentColor: e.target.value }))} className="h-9 w-12 cursor-pointer rounded border p-1" />
                    <Input type="text" value={theme.stepPillCurrentColor ?? ""} onChange={(e) => setTheme((t) => ({ ...t, stepPillCurrentColor: e.target.value }))} placeholder="#ffffff" className="font-mono text-xs flex-1" />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Default (not reached)</Label>
                  <div className="flex items-center gap-2">
                    <Input type="color" value={toHexForPicker(theme.stepPillDefaultColor, DEFAULT_EMBED_THEME.stepPillDefaultColor!)} onChange={(e) => setTheme((t) => ({ ...t, stepPillDefaultColor: e.target.value }))} className="h-9 w-12 cursor-pointer rounded border p-1" />
                    <Input type="text" value={theme.stepPillDefaultColor ?? ""} onChange={(e) => setTheme((t) => ({ ...t, stepPillDefaultColor: e.target.value }))} placeholder="#e5e7eb" className="font-mono text-xs flex-1" />
                  </div>
                </div>
              </div>
            </div>
            <div className="space-y-3">
              <Label className="text-sm font-medium">Custom CSS</Label>
              <p className="text-xs text-muted-foreground">
                Add your own CSS. Scope to the widget with <code className="rounded bg-muted px-1 py-0.5 text-xs">.embed-booking-widget</code> (e.g. <code className="rounded bg-muted px-1 py-0.5 text-xs">.embed-booking-widget .my-class</code>).
              </p>
              <textarea
                value={theme.customCss ?? ""}
                onChange={(e) => setTheme((t) => ({ ...t, customCss: e.target.value }))}
                placeholder={".embed-booking-widget .embed-outline-btn {\n  border-radius: 8px;\n}\n.embed-booking-widget input {\n  font-size: 1rem;\n}"}
                className="min-h-[140px] w-full rounded-md border bg-muted/30 px-3 py-2 font-mono text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                spellCheck={false}
              />
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
    </div>
  );
}
