import type { Metadata } from "next";
import { Inter, Poppins } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

/**
 * Typography System:
 * - Poppins: Bold, geometric sans-serif for headings & brand identity.
 *   Matches the clean, modern English text in the Square Kufic logo.
 * - Inter: Highly legible sans-serif for body text.
 *   Optimized for screen reading — perfect for course materials and chat.
 */
const poppins = Poppins({
  variable: "--font-heading",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Nisa Al-Huda | Women of Guidance",
    template: "%s | Nisa Al-Huda",
  },
  description:
    "A digital learning ecosystem for the Sisterhood Islamic community. Explore programs, courses, and workshops in Fiqh, Arabic, Hadith, and Qur'an.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${poppins.variable} ${inter.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col font-sans" suppressHydrationWarning>
        {children}
        <Toaster position="top-right" richColors />
      </body>
    </html>
  );
}
