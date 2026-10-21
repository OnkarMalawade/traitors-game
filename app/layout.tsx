import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Traitors — Trust No One",
  description: "A social deduction party game. One word. One traitor. Who can you trust?",
  viewport: "width=device-width, initialScale: 1, maximumScale: 1"
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}