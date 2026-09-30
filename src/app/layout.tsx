import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "UNIFY / POS simulator", description: "Prepared sales. Real wallet checkout. A UNIFY test-money demonstration." };
export default function RootLayout({ children }: { children: React.ReactNode }) { return <html lang="en"><body>{children}</body></html>; }
