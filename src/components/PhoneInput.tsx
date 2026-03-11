import * as React from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { ChevronDown } from "lucide-react";

const flagEmoji = (countryCode: string) =>
  String.fromCodePoint(
    ...[...countryCode.toUpperCase()].map((c) => 0x1f1e6 - 65 + c.charCodeAt(0))
  );

const COUNTRY_LIST: { code: string; dial: string; name: string }[] = [
  { code: "NL", dial: "+31", name: "Netherlands" },
  { code: "BE", dial: "+32", name: "Belgium" },
  { code: "DE", dial: "+49", name: "Germany" },
  { code: "FR", dial: "+33", name: "France" },
  { code: "GB", dial: "+44", name: "United Kingdom" },
  { code: "US", dial: "+1", name: "United States" },
  { code: "ES", dial: "+34", name: "Spain" },
  { code: "IT", dial: "+39", name: "Italy" },
  { code: "AT", dial: "+43", name: "Austria" },
  { code: "CH", dial: "+41", name: "Switzerland" },
  { code: "PL", dial: "+48", name: "Poland" },
  { code: "IN", dial: "+91", name: "India" },
  { code: "AU", dial: "+61", name: "Australia" },
  { code: "CA", dial: "+1", name: "Canada" },
  { code: "BR", dial: "+55", name: "Brazil" },
  { code: "PT", dial: "+351", name: "Portugal" },
  { code: "SE", dial: "+46", name: "Sweden" },
  { code: "NO", dial: "+47", name: "Norway" },
  { code: "DK", dial: "+45", name: "Denmark" },
  { code: "IE", dial: "+353", name: "Ireland" },
  { code: "LU", dial: "+352", name: "Luxembourg" },
  { code: "CZ", dial: "+420", name: "Czech Republic" },
  { code: "GR", dial: "+30", name: "Greece" },
  { code: "RO", dial: "+40", name: "Romania" },
  { code: "HU", dial: "+36", name: "Hungary" },
  { code: "TR", dial: "+90", name: "Turkey" },
  { code: "RU", dial: "+7", name: "Russia" },
  { code: "CN", dial: "+86", name: "China" },
  { code: "JP", dial: "+81", name: "Japan" },
  { code: "ZA", dial: "+27", name: "South Africa" },
  { code: "MX", dial: "+52", name: "Mexico" },
  { code: "AE", dial: "+971", name: "United Arab Emirates" },
  { code: "SA", dial: "+966", name: "Saudi Arabia" },
];

function parsePhoneValue(value: string): { dial: string; national: string } {
  const v = (value || "").trim();
  if (!v) return { dial: "+31", national: "" };
  // Match only known dial codes (longest first) so e.g. "+316" → +31 + "6", not +316 + ""
  const sortedByLength = [...COUNTRY_LIST].sort((a, b) => b.dial.length - a.dial.length);
  for (const c of sortedByLength) {
    if (v === c.dial || v.startsWith(c.dial)) {
      const rest = v.slice(c.dial.length).replace(/\s/g, "").replace(/\D/g, "");
      return { dial: c.dial, national: rest };
    }
  }
  // No known dial code at start: treat whole value as national for default country
  const digits = v.replace(/\D/g, "");
  return { dial: "+31", national: digits };
}

function findCountryByDial(dial: string) {
  return COUNTRY_LIST.find((c) => c.dial === dial) ?? COUNTRY_LIST[0];
}

export interface PhoneInputProps extends Omit<React.ComponentProps<typeof Input>, "value" | "onChange"> {
  value?: string;
  onChange?: (value: string) => void;
  className?: string;
}

export const PhoneInput = React.forwardRef<HTMLInputElement, PhoneInputProps>(
  ({ value = "", onChange, className, ...props }, ref) => {
    const parsed = parsePhoneValue(value);
    const [dial, setDial] = React.useState(parsed.dial);
    const [national, setNational] = React.useState(parsed.national);
    const [open, setOpen] = React.useState(false);

    const selected = findCountryByDial(dial);

    React.useEffect(() => {
      const p = parsePhoneValue(value);
      setDial(p.dial);
      setNational(p.national);
    }, [value]);

    const emit = React.useCallback(
      (newDial: string, newNational: string) => {
        const digits = newNational.replace(/\D/g, "");
        const full = digits ? `${newDial}${digits}` : "";
        onChange?.(full);
      },
      [onChange]
    );

    const handleDialChange = (c: (typeof COUNTRY_LIST)[0]) => {
      setDial(c.dial);
      setOpen(false);
      emit(c.dial, national);
    };

    const handleNationalChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = e.target.value.replace(/\D/g, "");
      setNational(v);
      emit(dial, v);
    };

    return (
      <div className={cn("flex rounded-md border border-input bg-background ring-offset-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2", className)}>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="flex items-center gap-1.5 pl-3 pr-2 py-2 text-sm border-r border-input bg-muted/30 hover:bg-muted/50 focus:outline-none focus:ring-0 rounded-l-md"
              aria-label="Country code"
            >
              <span className="text-lg leading-none" aria-hidden>
                {flagEmoji(selected.code)}
              </span>
              <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-180")} />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-[280px] p-0" align="start">
            <div className="max-h-[280px] overflow-y-auto">
              {COUNTRY_LIST.map((c) => (
                <button
                  key={c.code}
                  type="button"
                  className="flex items-center gap-3 w-full px-3 py-2 text-left text-sm hover:bg-muted rounded-none"
                  onClick={() => handleDialChange(c)}
                >
                  <span className="text-lg leading-none">{flagEmoji(c.code)}</span>
                  <span className="flex-1 font-medium">{c.name}</span>
                  <span className="text-muted-foreground">{c.dial}</span>
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>
        <Input
          ref={ref}
          type="tel"
          inputMode="numeric"
          autoComplete="tel-national"
          placeholder="6 12345678"
          value={national}
          onChange={handleNationalChange}
          className="border-0 rounded-l-none focus-visible:ring-0 focus-visible:ring-offset-0 pl-2 bg-transparent"
          {...props}
        />
      </div>
    );
  }
);
PhoneInput.displayName = "PhoneInput";
