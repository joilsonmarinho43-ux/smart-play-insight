import { Home, Zap, Star, Shield, LogOut } from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/hooks/useProfile";
import logoImg from "@/assets/logo-analista-joilson.png";

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
        {/* Logo */}
        <div className={`flex items-center justify-center px-4 pt-6 ${collapsed ? "pb-2" : "pb-6"}`}>
          <img
            src={logoImg}
            alt="Analista Joilson"
            className={`object-contain transition-all duration-300 ${
              collapsed ? "w-10" : "w-[180px]"
            }`}
          />
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
