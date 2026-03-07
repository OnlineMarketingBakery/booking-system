import { useOrganization } from "@/hooks/useOrganization";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Copy, Code } from "lucide-react";

export default function Embed() {
  const { organization } = useOrganization();
  const { toast } = useToast();

  const embedUrl = `${window.location.origin}/book/${organization?.slug}`;
  const embedCode = `<iframe\n  src="${embedUrl}"\n  width="100%"\n  height="800"\n  frameborder="0"\n  style="border: none; border-radius: 12px;"\n></iframe>`;

  const copy = () => {
    navigator.clipboard.writeText(embedCode);
    toast({ title: "Copied!", description: "Embed code copied to clipboard." });
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
