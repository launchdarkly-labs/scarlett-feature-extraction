import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sales Transcript Extractor",
  description: "AI-powered sales call analysis using Vercel AI Gateway and LaunchDarkly",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-gray-50">{children}</body>
    </html>
  );
}
