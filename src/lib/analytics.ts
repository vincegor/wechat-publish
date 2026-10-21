/**
 * Optional, opt-in analytics.
 *
 * Disabled by default: set `VITE_CLARITY_ID` at build time to enable it.
 * The upstream project hard-coded its own Microsoft Clarity project id, which
 * meant every fork of this app reported its visitors to that project. Keeping
 * it opt-in avoids shipping someone else's analytics id.
 */
const CLARITY_ID = import.meta.env.VITE_CLARITY_ID as string | undefined;

export function initAnalytics(): void {
    if (!CLARITY_ID) return;

    const clarity = (window as unknown as Record<string, unknown>).clarity;
    if (clarity) {
        (clarity as (command: string, ...args: unknown[]) => void)('create', CLARITY_ID);
        return;
    }

    const script = document.createElement('script');
    script.async = true;
    script.src = `https://www.clarity.ms/tag/${CLARITY_ID}`;
    document.head.appendChild(script);
}
