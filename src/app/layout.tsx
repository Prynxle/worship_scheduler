import type { Metadata } from "next";
import { Geist_Mono, Fraunces } from "next/font/google";
import localFont from "next/font/local";
import "./globals.css";

const jakartaSans = localFont({
  variable: "--font-sans",
  src: [
    {
      path: "./fonts/plus-jakarta-sans-latin.woff2",
      weight: "300 800",
      style: "normal",
    },
  ],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const fraunces = Fraunces({
  variable: "--font-display",
  subsets: ["latin"],
  axes: ["opsz"],
});

export const metadata: Metadata = {
  title: "Jesus Our Hope International Assemblies",
  description: "Jesus Our Hope International Assemblies",
  icons: {
    icon: "/icon-removebg-preview.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`dark ${jakartaSans.variable} ${geistMono.variable} ${fraunces.variable} h-full antialiased`}
    >
      <body className="h-full overflow-hidden flex flex-col">
        {children}
      </body>
    </html>
  );
}
