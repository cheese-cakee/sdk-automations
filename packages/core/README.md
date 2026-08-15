# Core

Core contains the small pure part of the linked-issue advisory:

1. strict parsing of `.github/hiero-automations.yml`;
2. admission of supported open pull-request deliveries for the configured owner/name;
3. the `present` / `absent` / `unknown` observation boundary;
4. one pure decision that produces the canonical dry-run result.

It also exports the webhook signature and delivery-GUID primitives used by shell and Store.
