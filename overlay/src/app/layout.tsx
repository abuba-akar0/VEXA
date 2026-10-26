import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "VEXA Overlay",
  description: "Virtual Execution & X-Layer Architect Overlay",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="bg-transparent overflow-hidden select-none">
      <body className="bg-transparent overflow-hidden select-none antialiased min-h-screen w-screen">
        {children}
      </body>
    </html>
  );
}
