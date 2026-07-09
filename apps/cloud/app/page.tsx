import Link from "next/link";

function Card({
  title,
  status,
  children,
  href,
  cta,
}: {
  title: string;
  status?: string;
  children: React.ReactNode;
  href?: string;
  cta?: string;
}) {
  return (
    <div className="flex flex-col rounded-xl border border-card-edge bg-card p-6">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-lg font-semibold">{title}</h3>
        {status ? (
          <span className="rounded-full border border-card-edge px-2.5 py-0.5 text-xs text-muted">
            {status}
          </span>
        ) : null}
      </div>
      <p className="mt-2 flex-1 text-sm leading-relaxed text-muted">
        {children}
      </p>
      {href && cta ? (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="mt-4 inline-block w-fit rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-night hover:brightness-110"
        >
          {cta}
        </a>
      ) : null}
    </div>
  );
}

export default function Home() {
  return (
    <div className="mx-auto max-w-5xl px-6">
      {/* Hero */}
      <section className="py-20 text-center sm:py-28">
        <h1 className="mx-auto max-w-3xl text-4xl font-bold leading-tight sm:text-5xl">
          YawningFace Block — defend your attention on{" "}
          <span className="text-accent">every device</span>
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-muted">
          One blocklist, synced everywhere. Define what distracts you and when
          it should be blocked — your laptop, browser, and phone all enforce
          the same rules. Open source, self-hostable, and yours: your data
          lives in your own Supabase project.
        </p>
        <div className="mt-8 flex items-center justify-center gap-4">
          <a
            href="https://github.com/Yawningface/block_desktop/releases/latest"
            target="_blank"
            rel="noreferrer"
            className="rounded-lg bg-accent px-6 py-3 font-semibold text-night hover:brightness-110"
          >
            Download for desktop
          </a>
          <Link
            href="/setup"
            className="rounded-lg border border-card-edge px-6 py-3 font-semibold text-white hover:border-accent"
          >
            Self-host it
          </Link>
        </div>
      </section>

      {/* Clients */}
      <section className="pb-16">
        <h2 className="text-2xl font-bold">Get the clients</h2>
        <div className="mt-6 grid gap-6 sm:grid-cols-3">
          <Card
            title="Desktop"
            href="https://github.com/Yawningface/block_desktop/releases/latest"
            cta="Download"
          >
            Mac and Windows apps that block distracting websites and
            applications system-wide. Sign in once with a device code and your
            blocklists follow you.
          </Card>
          <Card title="iPhone" status="coming soon">
            Native iOS app via TestFlight. Blocks distracting apps and sites on
            the device where willpower goes to die.
          </Card>
          <Card title="Chrome extension" status="coming soon">
            Lightweight enforcement right in the browser — same blocklists,
            same schedule, zero extra setup.
          </Card>
        </div>
      </section>

      {/* Self-host */}
      <section className="pb-24">
        <div className="rounded-xl border border-card-edge bg-card p-8 sm:p-10">
          <h2 className="text-2xl font-bold">
            Self-host in <span className="text-accent">15 minutes</span>
          </h2>
          <p className="mt-3 max-w-2xl leading-relaxed text-muted">
            This hub is a small Next.js app you deploy to Vercel for free, with
            Supabase for storage and Auth0 for sign-in — both on free tiers. No
            servers to babysit, no subscription, no one else holding your
            attention data.
          </p>
          <Link
            href="/setup"
            className="mt-6 inline-block rounded-lg bg-accent px-6 py-3 font-semibold text-night hover:brightness-110"
          >
            Read the setup guide
          </Link>
        </div>
      </section>
    </div>
  );
}
