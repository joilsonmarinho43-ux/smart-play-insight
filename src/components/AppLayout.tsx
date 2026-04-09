import { ReactNode } from "react";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { Menu } from "lucide-react";
import globeIcon from "@/assets/icon-globe.png";

export function AppLayout({ children }: { children: ReactNode }) {
  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-[#0f172a]">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          {/* Mobile trigger */}
          <header className="h-14 flex items-center md:hidden sticky top-0 z-50 bg-[#0f172a]/95 backdrop-blur-xl border-b border-white/10 px-3 gap-3">
            <SidebarTrigger className="flex items-center gap-2 px-3 py-2 rounded-xl bg-orange-500/15 border border-orange-500/30 text-orange-400 hover:bg-orange-500/25 hover:text-orange-300 hover:border-orange-400/50 active:scale-95 transition-all duration-200 shadow-[0_0_12px_rgba(249,115,22,0.15)]">
              <Menu className="w-6 h-6" />
              <span className="text-[10px] font-bold tracking-[0.15em] uppercase">Menu</span>
            </SidebarTrigger>
            <div className="flex items-center gap-2 ml-auto">
              <img src={globeIcon} alt="" className="w-5 h-5 object-contain" />
              <span className="text-sm font-bold text-white tracking-wide">ANALISTA JOILSON</span>
            </div>
          </header>
          <main className="flex-1">{children}</main>
        </div>
      </div>
    </SidebarProvider>
  );
}
