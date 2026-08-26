"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bot,
  BrainCircuit,
  ChevronsUp,
  LayoutDashboard,
  MessageCircleMore,
  Radio,
  Settings2,
} from "lucide-react";

const navigation = [
  { href: "/", label: "Visão geral", icon: LayoutDashboard },
  { href: "/chat", label: "Conversar", icon: MessageCircleMore },
  { href: "/memory", label: "Memória", icon: BrainCircuit },
  { href: "/calls", label: "Calls", icon: Radio },
  { href: "/discord", label: "Discord bot", icon: Bot },
];

export function AppShell({ children }: Readonly<{ children: React.ReactNode }>) {
  const pathname = usePathname();
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link href="/" className="brand" aria-label="Página inicial do Gudman">
          <span className="brand-mark"><ChevronsUp size={20} strokeWidth={2.4} /></span>
          <span><strong>Gudman</strong><small>central pessoal</small></span>
        </Link>
        <nav className="main-nav" aria-label="Navegação principal">
          {navigation.map(({ href, label, icon: Icon }) => {
            const active = href === "/" ? pathname === href : pathname.startsWith(href);
            return (
              <Link key={href} href={href} className={active ? "nav-link active" : "nav-link"}>
                <Icon size={19} />
                <span>{label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="sidebar-footer">
          <Link href="/settings" className={pathname.startsWith("/settings") ? "nav-link active" : "nav-link"}>
            <Settings2 size={19} /><span>Configurações</span>
          </Link>
          <div className="privacy-note"><span className="status-dot ok" />Execução local</div>
        </div>
      </aside>
      <main className="main-content">{children}</main>
      <nav className="mobile-nav" aria-label="Navegação móvel">
        {navigation.slice(0, 5).map(({ href, label, icon: Icon }) => {
          const active = href === "/" ? pathname === href : pathname.startsWith(href);
          return <Link key={href} href={href} className={active ? "active" : ""}><Icon size={20} /><span>{label.split(" ")[0]}</span></Link>;
        })}
      </nav>
    </div>
  );
}
