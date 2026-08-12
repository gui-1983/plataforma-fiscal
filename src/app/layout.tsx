import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Inteligência Tributária — Validador Fiscal",
  description: "Validação e auditoria de documentos fiscais na Reforma Tributária",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
