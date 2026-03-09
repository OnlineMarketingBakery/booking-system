import { useRef, useCallback, useMemo } from "react";

const HONEYPOT_NAME = "website_url";
const MIN_SUBMIT_SECONDS = 2;

export type SpamProtectionOptions = {
  /** Minimum seconds user must spend on form before submit (default 2). */
  minSeconds?: number;
  /** For forms in dialogs: pass the dialog open state so timer starts when form is shown. */
  formVisible?: boolean;
};

export function useSpamProtection(options?: SpamProtectionOptions) {
  const minSeconds = options?.minSeconds ?? MIN_SUBMIT_SECONDS;
  const startTimeRef = useRef<number | null>(null);
  const honeypotName = useRef(HONEYPOT_NAME).current;

  const setFormStarted = useCallback(() => {
    startTimeRef.current = Date.now();
  }, []);

  const validateSpamProtection = useCallback(
    (form: FormData | HTMLFormElement): boolean => {
      const data = form instanceof FormData ? form : new FormData(form);
      const honeypotValue = data.get(honeypotName);
      if (honeypotValue != null && String(honeypotValue).trim() !== "") {
        return false;
      }
      const start = startTimeRef.current;
      if (start == null) return false;
      const elapsed = (Date.now() - start) / 1000;
      if (elapsed < minSeconds) return false;
      return true;
    },
    [honeypotName, minSeconds]
  );

  const spamProtectionFieldsProps = useMemo(
    () => ({
      honeypotName,
      setFormStarted,
    }),
    [setFormStarted]
  );

  return {
    validateSpamProtection,
    SpamProtectionFieldsProps: spamProtectionFieldsProps,
  };
}
