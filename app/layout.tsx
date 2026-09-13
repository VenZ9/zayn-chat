import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Zayn Chat",
  description: "A lightweight AI assistant with streaming responses.",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0b0d10",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
