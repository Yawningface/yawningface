import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "YawningFace Block",
  description:
    "Defend your attention on every device. Open-source, self-hostable distraction blocking synced across desktop, browser, and phone.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <header className="border-b border-card-edge">
          <nav className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
            <Link href="/" className="flex items-center gap-2 font-semibold">
              <span aria-hidden className="text-xl">🥱</span>
              <span>
                YawningFace <span className="text-accent">Block</span>
              </span>
            </Link>
            <div className="flex items-center gap-6 text-sm text-muted">
              <Link href="/setup" className="hover:text-white">
                Self-host
              </Link>
              <a
                href="https://github.com/Yawningface"
                className="hover:text-white"
                target="_blank"
                rel="noreferrer"
              >
                GitHub
              </a>
            </div>
          </nav>
        </header>
        <main>{children}</main>
        <footer className="border-t border-card-edge">
          <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-2 px-6 py-8 text-sm text-muted sm:flex-row">
            <p>Built in the open by Yawningface.</p>
            <a
              href="https://github.com/Yawningface"
              className="hover:text-white"
              target="_blank"
              rel="noreferrer"
            >
              github.com/Yawningface
            </a>
          </div>
        </footer>
      </body>
    </html>
  );
}
