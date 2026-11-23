import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { SiteHeader } from "@/components/SiteHeader";
import "./globals.css";

export const metadata: Metadata = {
  title: "Gambit Arena — Chess with 3D capture fights",
  description:
    "Play real chess online. Every capture triggers a first-person 3D duel where each piece has its own weapons and abilities.",
};

export const viewport: Viewport = {
  themeColor: "#0a0d13",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">
        <SiteHeader />
        {children}
      </body>
    </html>
  );
}
