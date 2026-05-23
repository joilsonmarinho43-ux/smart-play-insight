import { Home, Zap, Star, Shield, LogOut, Crosshair, Trophy, Activity, Radar } from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/hooks/useProfile";

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
  { title: "Scanner PRO", url: "/scanner", icon: Crosshair },
  { title: "Bingo VIP PRO", url: "/bingo", icon: Trophy },
  { title: "Favoritos", url: "/favorites", icon: Star },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();
  const { signOut } = useAuth();
  const { profile } = useProfile();

  return (
    <Sidebar collapsible="icon" className="border-r border-white/10 bg-[#0f172a]">
      <SidebarContent className="bg-[#0f172a]">
        {/* Banner Header — geometric gradient background edge-to-edge */}
        <div
          className={`relative w-full overflow-hidden ${collapsed ? "py-3" : "py-8"}`}
          style={{
            background: "linear-gradient(135deg, #0a0a0a 0%, #1a1000 30%, #2a1800 50%, #1a1000 70%, #0a0a0a 100%)",
          }}
        >
          {/* Geometric mesh overlay */}
          <div className="absolute inset-0 opacity-30" style={{
            backgroundImage: `
              linear-gradient(30deg, hsl(30 80% 40% / 0.15) 12%, transparent 12.5%, transparent 87%, hsl(30 80% 40% / 0.15) 87.5%, hsl(30 80% 40% / 0.15)),
              linear-gradient(150deg, hsl(30 80% 40% / 0.15) 12%, transparent 12.5%, transparent 87%, hsl(30 80% 40% / 0.15) 87.5%, hsl(30 80% 40% / 0.15)),
              linear-gradient(30deg, hsl(30 80% 40% / 0.15) 12%, transparent 12.5%, transparent 87%, hsl(30 80% 40% / 0.15) 87.5%, hsl(30 80% 40% / 0.15)),
              linear-gradient(150deg, hsl(30 80% 40% / 0.15) 12%, transparent 12.5%, transparent 87%, hsl(30 80% 40% / 0.15) 87.5%, hsl(30 80% 40% / 0.15)),
              linear-gradient(60deg, hsl(35 70% 30% / 0.25) 25%, transparent 25.5%, transparent 75%, hsl(35 70% 30% / 0.25) 75%, hsl(35 70% 30% / 0.25)),
              linear-gradient(60deg, hsl(35 70% 30% / 0.25) 25%, transparent 25.5%, transparent 75%, hsl(35 70% 30% / 0.25) 75%, hsl(35 70% 30% / 0.25))
            `,
            backgroundSize: '40px 70px',
            backgroundPosition: '0 0, 0 0, 20px 35px, 20px 35px, 0 0, 20px 35px',
          }} />
          {/* Radial glow */}
          <div className="absolute inset-0" style={{
            background: "radial-gradient(ellipse at center, hsl(30 90% 50% / 0.12) 0%, transparent 70%)",
          }} />
          {/* Horizontal gold lines */}
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[hsl(35,80%,50%,0.4)] to-transparent" />
          <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[hsl(35,80%,50%,0.4)] to-transparent" />

          {/* Brand text */}
          {!collapsed ? (
            <div className="relative z-10 flex flex-col items-center justify-center px-4 text-center">
              <span
                className="font-display text-[2.2rem] leading-[1] tracking-[0.08em] uppercase"
                style={{
                  background: "linear-gradient(180deg, #f5c842 0%, #e8a020 40%, #c97b18 100%)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  filter: "drop-shadow(0 2px 8px hsl(30 90% 45% / 0.4))",
                }}
              >
                Nexus
              </span>
              <span
                className="font-display text-[2.8rem] leading-[1] tracking-[0.1em] uppercase -mt-1"
                style={{
                  background: "linear-gradient(180deg, #ffd970 0%, #f5c842 30%, #d4960a 100%)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  filter: "drop-shadow(0 2px 12px hsl(35 95% 50% / 0.5))",
                }}
              >
                33
              </span>
              <span
                className="mt-2 text-[0.85rem] font-bold tracking-[0.25em] uppercase"
                style={{
                  color: "hsl(35, 60%, 55%)",
                  textShadow: "0 0 10px hsl(30 80% 50% / 0.3)",
                }}
              >
                Modelo Real Pro
              </span>
            </div>
          ) : (
            <div className="relative z-10 flex items-center justify-center">
              <span
                className="font-display text-2xl font-black"
                style={{
                  background: "linear-gradient(180deg, #f5c842 0%, #d4960a 100%)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                }}
              >
                AJ
              </span>
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
                      activeClassName="bg-orange-500/10 text-orange-500 font-bold"
                    >
                      <item.icon className="h-5 w-5 shrink-0" />
                      {!collapsed && <span className="text-sm">{item.title}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}

              {/* Admin link */}
              {profile?.is_admin && (
                <>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild>
                      <NavLink
                        to="/quality"
                        className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-gray-400 hover:bg-white/5 hover:text-white transition-colors"
                        activeClassName="bg-orange-500/10 text-orange-500 font-bold"
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
                        activeClassName="bg-orange-500/10 text-orange-500 font-bold"
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
                        activeClassName="bg-orange-500/10 text-orange-500 font-bold"
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
      <SidebarFooter className="bg-[#0f172a] border-t border-white/10 p-3">
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
