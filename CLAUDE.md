# Ultra IPTV

Read `docs/engineering.md` before changing code. It holds the rules, conventions and the new feature checklist. `docs/performance.md` holds the budgets and how to measure them.

Hard rules:

- No third-party services or telemetry. Nothing readable leaves the device. The relay (`apps/relay`) only ever holds encrypted data, and is only contacted when the user presses Refresh, or changes a playlist after having pressed it once.
- Never type, read or print a real IPTV login. Keep real channel names, hosts and logins out of this public repo.
- Performance tests may use the account already signed in on a device, one device at a time. Everyday development uses the mock provider.
- Every action works by remote, touch and mouse. Moving focus never acts.
- Every string goes in `i18n/en.ts` and `i18n/ar.ts`.
- `pnpm check` passes before every commit. Commit or push only when asked.
