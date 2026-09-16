import { Home, Zap, Star, Shield, LogOut, Crosshair, Trophy, Crown, Target, Lightbulb, Activity, Radar, ZoomIn, ZoomOut } from 'lucide-react';
import { NavLink } from '@/components/NavLink';
import { useSidebar } from '@/components/ui/sidebar';
import { useAuth } from '@/hooks/useAuth';
import { useProfile } from '@/hooks/useProfile';
import { useFontScale } from '@/hooks/useFontScale';
import { Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarFooter } from '@/components/ui/sidebar';

type NavItem = { title: string; url: string; icon: typeof Home };
const navItems: NavItem[] = [
  { title: 'Análise Pré-Jogo', url: '/', icon: Home },
  { title: 'Análise Ao Vivo', url: '/live', icon: Zap },
  { title: 'Scanner PRO', url: '/scanner', icon: Crosshair },
  { title: 'Bingo VIP PRO', url: '/bingo', icon: Trophy },
  { title: 'Elite Performance', url: '/elite', icon: Crown },
  { title: 'Placar Exato', url: '/placar-exato', icon: Target },
  { title: 'Bet Analyzer', url: '/bet-analyzer', icon: Crosshair },
  { title: 'Favoritos', url: '/favorites', icon: Star },
  { title: 'Sugestões', url: '/suggestions', icon: Lightbulb },
];

export function AppSidebar() {
  const { state, setOpenMobile, isMobile } = useSidebar();
  const collapsed = state === 'collapsed';
  const closeMobile = () => { if (isMobile) setOpenMobile(false); };
  const { signOut } = useAuth();
  const { profile } = useProfile();
  const { increase, decrease, canIncrease, canDecrease } = useFontScale();
  return <Sidebar collapsible="icon" className="border-r border-white/10 bg-[#0f172a]">
    <SidebarContent className="bg-[#0f172a]">
      <div className={`relative w-full overflow-hidden ${collapsed ? 'py-3' : 'py-8'}`} style={{background:'linear-gradient(135deg,#0a0a0a 0%,#1a1000 30%,#2a1800 50%,#1a1000 70%,#0a0a0a 100%)'}}>
        <div className="absolute inset-0 opacity-30" style={{backgroundImage:'linear-gradient(30deg,hsl(30 80% 40% / .15) 12%,transparent 12.5%,transparent 87%,hsl(30 80% 40% / .15) 87.5%),linear-gradient(150deg,hsl(30 80% 40% / .15) 12%,transparent 12.5%,transparent 87%,hsl(30 80% 40% / .15) 87.5%)',backgroundSize:'40px 70px'}} />
        {!collapsed ? <div className="relative z-10 flex flex-col items-center justify-center px-4 text-center"><span className="font-display text-[2.2rem] leading-none tracking-[.08em] uppercase text-orange-300">Analista</span><span className="font-display text-[2.8rem] leading-none tracking-[.1em] uppercase -mt-1 text-amber-300">Joilson</span><span className="mt-2 text-[.85rem] font-bold tracking-[.25em] uppercase text-orange-300/80">Modelo Real Pro</span></div> : <div className="relative z-10 flex items-center justify-center"><span className="font-display text-2xl font-black text-amber-300">AJ</span></div>}
      </div>
      <SidebarGroup>
        <SidebarGroupLabel className="px-3 text-[10px] uppercase tracking-widest text-gray-500">{!collapsed && 'Navegação'}</SidebarGroupLabel>
        <SidebarGroupContent><SidebarMenu>
          {navItems.map(item => <SidebarMenuItem key={item.title}><SidebarMenuButton asChild><NavLink to={item.url} end={item.url==='/' } onClick={closeMobile} className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-gray-400 transition-colors hover:bg-white/5 hover:text-white" activeClassName="bg-orange-500/10 text-orange-400 font-bold"><item.icon className="h-5 w-5 shrink-0" />{!collapsed&&<span className="text-sm">{item.title}</span>}</NavLink></SidebarMenuButton></SidebarMenuItem>)}
          {profile?.is_admin && <><SidebarMenuItem><SidebarMenuButton asChild><NavLink to="/quality" onClick={closeMobile} className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-gray-400" activeClassName="bg-orange-500/10 text-orange-400 font-bold"><Activity className="h-5 w-5 shrink-0" />{!collapsed&&<span className="text-sm">Quality Lab</span>}</NavLink></SidebarMenuButton></SidebarMenuItem><SidebarMenuItem><SidebarMenuButton asChild><NavLink to="/context" onClick={closeMobile} className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-gray-400" activeClassName="bg-orange-500/10 text-orange-400 font-bold"><Radar className="h-5 w-5 shrink-0" />{!collapsed&&<span className="text-sm">Contexto</span>}</NavLink></SidebarMenuButton></SidebarMenuItem><SidebarMenuItem><SidebarMenuButton asChild><NavLink to="/admin" onClick={closeMobile} className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-gray-400" activeClassName="bg-orange-500/10 text-orange-400 font-bold"><Shield className="h-5 w-5 shrink-0" />{!collapsed&&<span className="text-sm">Admin</span>}</NavLink></SidebarMenuButton></SidebarMenuItem></>}
        </SidebarMenu></SidebarGroupContent>
      </SidebarGroup>
    </SidebarContent>
    <SidebarFooter className="space-y-2 border-t border-white/10 bg-[#0f172a] p-3">
      <div className="flex items-center gap-1 px-1"><span className="text-[10px] font-medium text-gray-500">{!collapsed?'Zoom':''}</span><button onClick={decrease} disabled={!canDecrease} aria-label="Diminuir tamanho da fonte" className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-gray-300 disabled:opacity-40"><ZoomOut className="h-4 w-4"/></button><button onClick={increase} disabled={!canIncrease} aria-label="Aumentar tamanho da fonte" className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-gray-300 disabled:opacity-40"><ZoomIn className="h-4 w-4"/></button></div>
      <button onClick={signOut} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-red-400 transition-colors hover:bg-red-500/10"><LogOut className="h-5 w-5 shrink-0"/>{!collapsed&&<span className="text-sm font-bold">SAIR</span>}</button>
    </SidebarFooter>
  </Sidebar>;
}
