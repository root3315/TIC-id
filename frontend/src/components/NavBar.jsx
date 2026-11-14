import { Link, useLocation } from "react-router-dom";
import { Telescope, Github } from "lucide-react";
import { useT, LangToggle } from "@/lib/i18n";

/* Навигация без «таблеток»: активный раздел отмечен линией по нижнему
   краю панели — там же, где полоса, разделяющая шапку и страницу. */
const NavBar = () => {
  const { pathname } = useLocation();
  const t = useT();

  const links = [
    // На телефоне «Поиск» прячем: логотип ведёт туда же, а места в шапке нет
    { to: "/", label: t("Поиск", "Search"), testid: "nav-search", wideOnly: true },
    { to: "/catalog", label: t("Каталог", "Catalog"), testid: "nav-catalog" },
    { to: "/ai-detector", label: t("AI-детектор", "AI Detector"), short: t("Детектор", "Detector"), testid: "nav-ai" },
  ];

  return (
    <nav className="fixed top-0 inset-x-0 z-50">
      <div className="panel border-x-0 border-t-0">
        <div className="max-w-7xl mx-auto px-4 sm:px-5 h-14 flex items-center justify-between gap-2">
          <Link to="/" className="flex items-center gap-2 sm:gap-2.5 shrink-0" data-testid="nav-logo"
                aria-label={t("ExoVision — на главную", "ExoVision home")}>
            <Telescope className="w-5 h-5" style={{ color: "var(--beam)" }} />
            <span className="text-[17px] font-semibold tracking-tight">
              <span style={{ color: "var(--beam)" }}>Exo</span>
              <span className="text-white">Vision</span>
            </span>
          </Link>

          <div className="flex items-center gap-1">
            {links.map((l) => {
              const active = pathname === l.to;
              return (
                <Link
                  key={l.to}
                  to={l.to}
                  data-testid={l.testid}
                  aria-current={active ? "page" : undefined}
                  className={`relative px-2 sm:px-3.5 h-14 items-center text-[13px] sm:text-sm font-medium whitespace-nowrap ${l.wideOnly ? "hidden sm:flex" : "flex"}`}
                  style={{ color: active ? "var(--ink)" : "var(--ink-3)" }}
                  onMouseEnter={(e) => { if (!active) e.currentTarget.style.color = "var(--ink)"; }}
                  onMouseLeave={(e) => { if (!active) e.currentTarget.style.color = "var(--ink-3)"; }}
                >
                  {l.short ? (
                    <>
                      <span className="sm:hidden">{l.short}</span>
                      <span className="hidden sm:inline">{l.label}</span>
                    </>
                  ) : l.label}
                  {active && (
                    <span
                      className="absolute inset-x-2.5 bottom-0 h-px"
                      style={{ background: "var(--beam)" }}
                    />
                  )}
                </Link>
              );
            })}
            <span className="hidden sm:block w-px h-5 mx-2" style={{ background: "var(--rule)" }} />
            <LangToggle />
            <a
              href="https://github.com/root3315/TIC-id"
              target="_blank"
              rel="noopener noreferrer"
              className="p-2 ml-1 hidden sm:block"
              style={{ color: "var(--ink-4)" }}
              onMouseEnter={(e) => { e.currentTarget.style.color = "var(--ink-2)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = "var(--ink-4)"; }}
              title="GitHub"
              aria-label="GitHub"
            >
              <Github className="w-4 h-4" />
            </a>
          </div>
        </div>
      </div>
    </nav>
  );
};

export default NavBar;
