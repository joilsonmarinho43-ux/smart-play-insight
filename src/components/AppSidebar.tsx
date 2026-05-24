import { Home, Zap, Star, Shield, LogOut, Trophy, Activity, Radar, ZoomIn, ZoomOut, Lightbulb, Crosshair } from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/hooks/useProfile";
import { useFontScale } from "@/hooks/useFontScale";
import { AUTO_BET_ENABLED } from "@/modules/auto-bet/config";

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarFooter,
  useSidebar,
} from "@/components/ui/sidebar";

const navItems = [
  { title: "Pré-Jogo", url: "/", icon: Home },
  { title: "Live Trader", url: "/live", icon: Zap },
  { title: "AutoPilot LIVE", url: "/autopilot", icon: Crosshair },
  { title: "Bingo VIP PRO", url: "/bingo", icon: Trophy },
  { title: "Favoritos", url: "/favorites", icon: Star },
  { title: "Sugestões", url: "/suggestions", icon: Lightbulb },
];

export function AppSidebar() {
  const { state, setOpenMobile, isMobile } = useSidebar();
  const collapsed = state === "collapsed";
  const handleNavClick = () => {
    if (isMobile) setOpenMobile(false);
  };
  const location = useLocation();
  const { signOut } = useAuth();
  const { profile } = useProfile();
  const { increase, decrease, canIncrease, canDecrease } = useFontScale();

  return (
    <Sidebar collapsible="icon" className="border-r border-white/10 bg-[#0f172a]">
      <SidebarContent className="bg-[#0f172a]">
        {/* Banner Header — premium minimal */}
        <div
          className={`relative w-full overflow-hidden ${collapsed ? "py-4" : "py-7"}`}
          style={{
            background:
              "radial-gradient(ellipse 120% 80% at 50% 0%, #1a1305 0%, #0d0a05 45%, #07070a 100%)",
          }}
        >
          {/* Subtle noise / vignette */}
          <div
            className="absolute inset-0 opacity-40 pointer-events-none"
            style={{
              background:
                "radial-gradient(ellipse at 50% 40%, hsl(38 95% 55% / 0.18) 0%, transparent 60%)",
            }}
          />
          {/* Thin gold rule top & bottom */}
          <div className="absolute top-0 left-6 right-6 h-px bg-gradient-to-r from-transparent via-[hsl(40,90%,55%,0.55)] to-transparent" />
          <div className="absolute bottom-0 left-6 right-6 h-px bg-gradient-to-r from-transparent via-[hsl(40,90%,55%,0.35)] to-transparent" />

          {!collapsed ? (
            <div className="relative z-10 flex flex-col items-center justify-center px-4 text-center">
              {/* Logo mark — hexagonal monogram */}
              <div className="relative mb-3">
                <div
                  className="absolute inset-0 blur-xl opacity-70"
                  style={{
                    background:
                      "radial-gradient(circle, hsl(40 95% 55% / 0.55) 0%, transparent 70%)",
                  }}
                />
                <div
                  className="relative h-12 w-12 rotate-45 rounded-md flex items-center justify-center"
                  style={{
                    background:
                      "linear-gradient(135deg, #1a1305 0%, #2a1d08 100%)",
                    border: "1px solid hsl(40 80% 45% / 0.6)",
                    boxShadow:
                      "inset 0 0 12px hsl(40 95% 50% / 0.25), 0 4px 18px hsl(40 90% 40% / 0.35)",
                  }}
                >
                  <span
                    className="-rotate-45 font-display text-base font-black tracking-tight"
                    style={{
                      background:
                        "linear-gradient(180deg, #ffe08a 0%, #f5c842 50%, #c97b18 100%)",
                      WebkitBackgroundClip: "text",
                      WebkitTextFillColor: "transparent",
                    }}
                  >
                    N33
                  </span>
                </div>
              </div>

              {/* Wordmark */}
              <div className="flex items-baseline gap-1.5">
                <span
                  className="font-display text-[1.6rem] leading-none tracking-[0.14em] uppercase"
                  style={{
                    background:
                      "linear-gradient(180deg, #fff5d6 0%, #f5c842 55%, #c97b18 100%)",
                    WebkitBackgroundClip: "text",
                    WebkitTextFillColor: "transparent",
                    filter: "drop-shadow(0 1px 6px hsl(40 90% 45% / 0.35))",
                  }}
                >
                  Nexus
                </span>
                <span
                  className="font-display text-[1.6rem] leading-none tracking-[0.06em]"
                  style={{
                    color: "hsl(40 92% 60%)",
                    textShadow: "0 0 12px hsl(40 95% 50% / 0.45)",
                  }}
                >
                  33
                </span>
              </div>

              {/* Divider ornament */}
              <div className="mt-2.5 flex items-center gap-2">
                <div className="h-px w-8 bg-gradient-to-r from-transparent to-[hsl(40,80%,50%,0.6)]" />
                <div className="h-1 w-1 rotate-45 bg-[hsl(40,90%,55%)]" />
                <div className="h-px w-8 bg-gradient-to-l from-transparent to-[hsl(40,80%,50%,0.6)]" />
              </div>

              <span
                className="mt-2 text-[0.62rem] font-semibold tracking-[0.35em] uppercase"
                style={{ color: "hsl(40 35% 65%)" }}
              >
                Modelo Real Pro
              </span>
            </div>
          ) : (
            <div className="relative z-10 flex items-center justify-center">
              <div
                className="relative h-9 w-9 rotate-45 rounded-md flex items-center justify-center"
                style={{
                  background: "linear-gradient(135deg, #1a1305 0%, #2a1d08 100%)",
                  border: "1px solid hsl(40 80% 45% / 0.6)",
                  boxShadow: "inset 0 0 10px hsl(40 95% 50% / 0.25)",
                }}
              >
                <span
                  className="-rotate-45 font-display text-xs font-black"
                  style={{
                    background:
                      "linear-gradient(180deg, #ffe08a 0%, #d4960a 100%)",
                    WebkitBackgroundClip: "text",
                    WebkitTextFillColor: "transparent",
                  }}
                >
                  N33
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Navigation */}
        <SidebarGroup>
          <SidebarGroupLabel className="text-gray-500 text-[10px] uppercase tracking-widest">
            Navegação
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild>
                    <NavLink
                      to={item.url}
                      end={item.url === "/"}
                      className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-gray-400 hover:bg-white/5 hover:text-white transition-colors"
                      onClick={handleNavClick} activeClassName="bg-orange-500/10 text-orange-500 font-bold"
                    >
                      <item.icon className="h-5 w-5 shrink-0" />
                      {!collapsed && <span className="text-sm">{item.title}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}

              {/* AutoPilot LIVE — gated por feature flag */}
              {AUTO_BET_ENABLED && (
                <SidebarMenuItem>
                  <SidebarMenuButton asChild>
                    <NavLink
                      to="/autopilot"
                      className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-gray-400 hover:bg-white/5 hover:text-white transition-colors"
                      onClick={handleNavClick} activeClassName="bg-orange-500/10 text-orange-500 font-bold"
                    >
                      <Crosshair className="h-5 w-5 shrink-0 text-orange-500" />
                      {!collapsed && <span className="text-sm">AutoPilot LIVE</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}


              {/* Admin link */}
              {profile?.is_admin && (
                <>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild>
                      <NavLink
                        to="/quality"
                        className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-gray-400 hover:bg-white/5 hover:text-white transition-colors"
                        onClick={handleNavClick} activeClassName="bg-orange-500/10 text-orange-500 font-bold"
                      >
                        <Activity className="h-5 w-5 shrink-0 text-orange-500" />
                        {!collapsed && <span className="text-sm">Quality Lab</span>}
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild>
                      <NavLink
                        to="/context"
                        className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-gray-400 hover:bg-white/5 hover:text-white transition-colors"
                        onClick={handleNavClick} activeClassName="bg-orange-500/10 text-orange-500 font-bold"
                      >
                        <Radar className="h-5 w-5 shrink-0 text-orange-500" />
                        {!collapsed && <span className="text-sm">Contexto</span>}
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild>
                      <NavLink
                        to="/admin"
                        className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-gray-400 hover:bg-white/5 hover:text-white transition-colors"
                        onClick={handleNavClick} activeClassName="bg-orange-500/10 text-orange-500 font-bold"
                      >
                        <Shield className="h-5 w-5 shrink-0 text-orange-500" />
                        {!collapsed && <span className="text-sm">Admin</span>}
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </>
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      {/* Logout */}
      <SidebarFooter className="bg-[#0f172a] border-t border-white/10 p-3 space-y-2">
        {/* Font zoom controls */}
        <div className={`flex items-center gap-1 ${collapsed ? 'justify-center' : 'justify-between'} px-1`}>
          {!collapsed && (
            <span className="text-[10px] text-gray-500 font-medium">Zoom</span>
          )}
          <div className="flex items-center gap-1">
            <button
              onClick={decrease}
              disabled={!canDecrease}
              aria-label="Diminuir tamanho da fonte"
              className="flex items-center justify-center w-8 h-8 rounded-lg bg-white/5 border border-white/10 text-gray-300 hover:bg-white/10 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ZoomOut className="h-4 w-4" />
            </button>
            <button
              onClick={increase}
              disabled={!canIncrease}
              aria-label="Aumentar tamanho da fonte"
              className="flex items-center justify-center w-8 h-8 rounded-lg bg-white/5 border border-white/10 text-gray-300 hover:bg-white/10 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ZoomIn className="h-4 w-4" />
            </button>
          </div>
        </div>

        <button
          onClick={signOut}
          className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-red-400 hover:bg-red-500/10 transition-colors"
        >
          <LogOut className="h-5 w-5 shrink-0" />
          {!collapsed && <span className="text-sm font-bold">SAIR</span>}
        </button>
      </SidebarFooter>
    </Sidebar>
  );
}
