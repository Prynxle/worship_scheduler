# Security Policy

## Supported versions

This project is maintained on the `main` and `staging` branches of its GitHub repository. Only the latest state of these branches receives security fixes.

## Reporting a vulnerability

Please use GitHub's **private vulnerability reporting** (enabled on this repository) to report security issues. Do not open public GitHub issues for vulnerabilities, and do not disclose details publicly until a fix is released.

When reporting, include:

- A clear description of the issue
- Steps to reproduce
- Expected vs actual behavior
- Screenshots or logs, if applicable

This keeps the report consistent with how general issues are described in our contributing guidelines, while ensuring the details stay private until they are addressed.

## Scope

In scope:

- The Next.js application and its API routes
- Supabase data access, Row Level Security policies, and migrations
- Authentication and session handling
- Any exposure of secrets, service-role credentials, or cross-tenant data

Out of scope:

- Issues that require physical access to a user's device
- Third-party services outside our control

## Security & privacy expectations

Aligned with our README and contributing guidelines:

- Tenant data is isolated by `church_id` and enforced by Row Level Security; reports of cross-tenant access are treated as critical.
- Browser clients only receive public, non-sensitive configuration; privileged operations stay server-side.
- Never commit secrets, tokens, or `.env` values. Scan changed files for credential-shaped literals before committing, and report any matched credentials rather than assuming they are benign.
- If you discover a committed secret, report it privately and treat it as an incident so it can be removed and rotated.

## Response

We aim to acknowledge private reports promptly and work with the reporter on a fix before public disclosure. Coordinated disclosure is appreciated.
