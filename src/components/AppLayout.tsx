import { ReactNode } from "react";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { Menu } from "lucide-react";

export function AppLayout({ children }: { children: ReactNode }) {
  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-[#0f172a]">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          {/* Mobile trigger */}
          <header className="h-12 flex items-center md:hidden sticky top-0 z-50 bg-[#0f172a]/90 backdrop-blur-md border-b border-white/10 px-3">
            <SidebarTrigger className="text-gray-400 hover:text-white">
              <Menu className="w-6 h-6" />
            </SidebarTrigger>
            <span className="ml-3 text-sm font-bold text-white">ANALISTA JOILSON</span>
          </header>
          <main className="flex-1">{children}</main>
        </div>
      </div>
    </SidebarProvider>
  );
}
