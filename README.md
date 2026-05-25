# World Cup Predictor

A mobile-first World Cup prediction app scaffold with Supabase authentication and a modern 2026-inspired UI.

## What is included

- React + Vite + TypeScript
- Tailwind CSS for a sleek mobile-first design
- Supabase auth + profile integration
- Prediction setup flow for matches and top scorers
- Local match data loader using a World Cup JSON schema

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create a Supabase project.
3. Add the following environment variables in a `.env` file:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

4. Create a `profiles` table in Supabase with columns:

- `id` (uuid, primary key)
- `full_name` (text)
- `avatar_url` (text)
- `has_completed_setup` (boolean, default false)
- `predictions` (jsonb)
- `top_scorer` (jsonb)
- `points` (integer, default 0)

5. Run the app:

```bash
npm run dev
```

## Notes

- Replace `src/data/worldcup2026.json` with the full 2026 match schedule from the OpenFootball dataset.
- This scaffold calculates points from actual match results and top scorer picks.
- The UI is optimized for modern mobile usage.

## Supabase setup and email guidance

Follow these steps to configure Supabase for minimal email usage and to enable password and OAuth logins.

- Create a Supabase project at https://app.supabase.com and open the project dashboard.

- Enable Authentication providers:
	- Go to **Authentication → Providers**.
	- Enable **Email** (Email / Password) and **Google** (or other OAuth providers you prefer).
	- For Google, add the OAuth Client ID and Client Secret from Google Cloud, and add `http://localhost:4173` to the Redirect URLs while developing.

- Configure SMTP (recommended to avoid hitting built-in email limits):
	- In **Authentication → Settings → Email** provide your SMTP credentials (SendGrid, Mailgun, Postmark, etc.).
	- This routes transactional emails through your provider and avoids small free-tier email rate limits.

- Email confirmation behavior (trade-offs):
	- By default, Supabase can require email confirmations for new accounts. This improves security (verifies ownership) but increases sent emails.
	- If you prefer fewer emails during signup (less friction), disable **Confirm email** in **Auth → Settings**. NOTE: this reduces account verification and increases risk of fake accounts.

- Recommended production settings:
	- Keep email confirmations enabled for production for better security.
	- Use an external SMTP provider to handle volume and deliverability.
	- Enable OAuth providers (Google, Apple) so users can sign in without email messages.

- Update your environment variables in `.env`:

```env
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-public-anon-key
```

- Local testing notes:
	- Add `http://localhost:4173` as an allowed redirect URL in Supabase Auth settings and in any OAuth provider console (Google Cloud).
	- Start the dev server:
```bash
npm run dev
```
	- Try creating an account with Email/Password or sign in with Google. If you disabled confirmations, the account should be usable immediately.

## Minimal security trade-offs summary

- Disable email confirmations: fewer emails, easier onboarding, but weaker verification and higher spam/fake accounts risk.
- Use external SMTP: small cost sometimes, much better deliverability and higher limits.
- Prefer OAuth for low-friction login without sending verification emails.

If you want, I can add a small admin UI to toggle whether confirmations are required (reads/writes a flag in a Supabase `settings` table), or wire up a SendGrid/Postmark example for SMTP configuration.
