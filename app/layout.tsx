import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Funding Explorer | Great Lakes I-Corps",
  description: "Explore follow-on funding and support after I-Corps.",
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
