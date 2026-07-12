import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Self-host YawningFace Block",
  description:
    "Step-by-step guide: Supabase, Auth0, Vercel, and the desktop app in about 15 minutes.",
};

function Step({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-card-edge bg-card p-6 sm:p-8">
      <h2 className="flex items-center gap-3 text-xl font-bold">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-bold text-night">
          {n}
        </span>
        {title}
      </h2>
      <div className="mt-4 space-y-4 text-sm leading-relaxed text-muted [&_strong]:text-white">
        {children}
      </div>
    </section>
  );
}

function Code({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-lg border border-card-edge bg-night p-4 text-xs leading-relaxed text-white">
      <code>{children}</code>
    </pre>
  );
}

const EXAMPLE_CONFIG = `{
  "config": {
    "version": 1,
    "blocklists": [
      {
        "id": "morning-focus",
        "name": "Morning Focus",
        "metadata": {
          "enabled": true,
          "severity": "block",
          "devices": ["desktop", "mobile", "tablet"],
          "timeZone": "Europe/Madrid",
          "timePeriods": [
            { "startTime": "09:00", "endTime": "13:00", "schedule": ["mon","tue","wed","thu","fri"] }
          ]
        },
        "targets": { "websites": ["twitter.com", "linkedin.com"], "apps": ["Discord", "Steam"] },
        "exceptions": []
      }
    ]
  }
}`;

export default function SetupPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-3xl font-bold sm:text-4xl">
        Self-host in <span className="text-accent">15 minutes</span>
      </h1>
      <p className="mt-4 leading-relaxed text-muted">
        You will stand up your own YawningFace Block cloud: a Supabase database
        for storage, an Auth0 tenant for sign-in, and this repo deployed to
        Vercel. Everything fits in the free tiers. You need a GitHub account
        and a terminal with <code className="text-white">curl</code>.
      </p>
      <p className="mt-3 leading-relaxed text-muted">
        Heads-up: there is <strong className="text-white">no dashboard UI in v1</strong>.
        The desktop app and the HTTP API are the interface - step 5 shows how
        to edit your config with <code className="text-white">curl</code>.
      </p>

      <div className="mt-10 space-y-6">
        <Step n={1} title="Create the Supabase project">
          <p>
            Go to{" "}
            <a
              href="https://supabase.com"
              className="text-accent hover:underline"
              target="_blank"
              rel="noreferrer"
            >
              supabase.com
            </a>{" "}
            and create a new project (any region, free tier is fine). Once it
            is ready:
          </p>
          <ol className="list-decimal space-y-2 pl-5">
            <li>
              Open <strong>SQL Editor</strong>, paste the contents of{" "}
              <code className="text-white">supabase/migrations/0001_init.sql</code>{" "}
              from this repo, and run it. It creates the{" "}
              <code className="text-white">profiles</code>,{" "}
              <code className="text-white">devices</code>,{" "}
              <code className="text-white">configs</code> and{" "}
              <code className="text-white">events</code> tables and enables RLS
              with no policies (only the server, using the service-role key,
              can touch the data).
            </li>
            <li>
              In <strong>Project Settings → API</strong>, copy the{" "}
              <strong>Project URL</strong> (this is{" "}
              <code className="text-white">SUPABASE_URL</code>) and the{" "}
              <strong>service_role key</strong> (this is{" "}
              <code className="text-white">SUPABASE_SERVICE_ROLE_KEY</code>).
              Treat the service-role key like a root password - it never
              leaves the server.
            </li>
          </ol>
        </Step>

        <Step n={2} title="Create the Auth0 tenant">
          <p>
            Sign up at{" "}
            <a
              href="https://auth0.com"
              className="text-accent hover:underline"
              target="_blank"
              rel="noreferrer"
            >
              auth0.com
            </a>{" "}
            (free tier) and create a tenant. You need two things: an{" "}
            <strong>API</strong> (so tokens carry the right audience) and a{" "}
            <strong>Native application</strong> (so the desktop app can sign
            in with a device code).
          </p>
          <p>
            <strong>a) Create the API.</strong> In{" "}
            <strong>Applications → APIs → Create API</strong>:
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              Name: anything, e.g. <em>YawningFace Block</em>.
            </li>
            <li>
              Identifier: a URI you control, e.g.{" "}
              <code className="text-white">https://block.example.com/api</code>.
              This exact string is your{" "}
              <code className="text-white">AUTH0_AUDIENCE</code>.
            </li>
            <li>
              In the API&apos;s <strong>Settings</strong>, enable{" "}
              <strong>Allow Offline Access</strong> (clients need refresh
              tokens so you do not have to sign in every day).
            </li>
          </ul>
          <p>
            <strong>b) Create the Native application.</strong> In{" "}
            <strong>Applications → Applications → Create Application</strong>,
            pick <strong>Native</strong>. Then in its <strong>Settings →
            Advanced Settings → Grant Types</strong>, make sure{" "}
            <strong>Device Code</strong> and <strong>Refresh Token</strong>{" "}
            are enabled, and save.
          </p>
          <p>
            <strong>c) Note your values.</strong> From the tenant/application
            settings, write down the <strong>Domain</strong> (e.g.{" "}
            <code className="text-white">your-tenant.eu.auth0.com</code> - this
            is <code className="text-white">AUTH0_DOMAIN</code>, no{" "}
            <code className="text-white">https://</code>) and the Native
            application&apos;s <strong>Client ID</strong> (the desktop app
            asks for it at sign-in).
          </p>
        </Step>

        <Step n={3} title="Deploy this repo to Vercel">
          <p>
            Fork or push this repository to your GitHub account, then import
            it at{" "}
            <a
              href="https://vercel.com/new"
              className="text-accent hover:underline"
              target="_blank"
              rel="noreferrer"
            >
              vercel.com/new
            </a>
            . Vercel detects Next.js automatically. Before deploying, set the
            environment variables (Project → Settings → Environment
            Variables):
          </p>
          <Code>{`AUTH0_DOMAIN=your-tenant.eu.auth0.com
AUTH0_AUDIENCE=https://block.example.com/api
SUPABASE_URL=https://YOUR-PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...   # service_role key from step 1
NEXT_PUBLIC_SITE_URL=https://your-deployment.vercel.app`}</Code>
          <p>
            Deploy, then verify the API is alive:
          </p>
          <Code>{`curl https://your-deployment.vercel.app/api/health
# → {"ok":true}`}</Code>
        </Step>

        <Step n={4} title="Install the desktop app and sign in">
          <p>
            Download the app for Mac or Windows from{" "}
            <a
              href="https://github.com/Yawningface/block_desktop/releases/latest"
              className="text-accent hover:underline"
              target="_blank"
              rel="noreferrer"
            >
              the latest release
            </a>
            . On first launch, point it at your cloud: enter your deployment
            URL, your Auth0 domain, the Native app&apos;s Client ID, and the
            API audience from step 2.
          </p>
          <p>
            The app then shows a short <strong>device code</strong> and opens
            your browser to Auth0&apos;s activation page. Confirm the code,
            sign in (or sign up), and the app receives its tokens - this is
            the Device Authorization Flow, the same thing your TV apps use.
            From then on it syncs your config from{" "}
            <code className="text-white">GET /api/v1/config</code> and reports
            events back automatically.
          </p>
        </Step>

        <Step n={5} title="Edit your config via the API">
          <p>
            Your blocklists live in one JSON document (the full schema is in{" "}
            <code className="text-white">docs/schema.md</code>). To edit it,
            you need an access token. The easiest way to get one is to copy it
            from the desktop app&apos;s settings; any token obtained from your
            Auth0 tenant with the right audience works.
          </p>
          <p>Read your current config:</p>
          <Code>{`export TOKEN="eyJ..."   # your access token
export BASE="https://your-deployment.vercel.app"

curl -s "$BASE/api/v1/config" -H "Authorization: Bearer $TOKEN"`}</Code>
          <p>
            Update it - for example, block Twitter and LinkedIn on weekday
            mornings everywhere:
          </p>
          <Code>{`curl -s -X PUT "$BASE/api/v1/config" \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '${EXAMPLE_CONFIG}'`}</Code>
          <p>
            Every signed-in device picks the new config up on its next sync.
            That&apos;s it - your attention now has a bouncer on every door.
          </p>
        </Step>
      </div>
    </div>
  );
}
