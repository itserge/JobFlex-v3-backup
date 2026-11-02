# Integration marks (landing, 2026-09-26)

The five apps JobFlex actually connects to. The landing's Integrations tiles
(`src/components/v3/landing-e/integrations-mobile.tsx`, `BrandMark`) inline
these paths so each mark can take its brand colour; the files here are the
sources as downloaded. The marks are the owners' trademarks, shown only to say
JobFlex works with them.

| File | Source | Colour used |
| --- | --- | --- |
| `stripe.svg` | simple-icons 16.32.0 (CC0), `icons/stripe.svg` via cdn.jsdelivr.net | `#635BFF` ground, white S (Stripe's app icon) |
| `square.svg` | simple-icons 16.32.0 (CC0), `icons/square.svg` | `#3E4348` |
| `meta.svg` | simple-icons 16.32.0 (CC0), `icons/meta.svg` | `#0467DF` |
| `gmail.svg` | Google's own product logo, fonts.gstatic.com/s/i/productlogos/gmail_2020q4/v8/192px.svg (the source simple-icons cites) | its own four colours |
| `stax-logo.svg` | staxpayments.com header logo (inline SVG in the page, 2026-09-26); the tile uses its `stax-logo-x` path | `#B93BE4` on `#062333` |
| `stax-app-icon.png` | staxpayments.com/apple-touch-icon.png — reference for the icon's colours | — |

Do not add a mark for an app JobFlex does not integrate with.

## Ramp review video (2026-10-31)

`ramp-demo.mp4` is the demo for Ramp's production-access application, served at
www.jobflex.app/integrations/ramp-demo.mp4. It shows Connect in Ramp's sandbox,
then one card per scope (the scopes in `src/lib/ramp/client.ts`). It is linked
only from that application.
