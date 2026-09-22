import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { Session } from '@supabase/supabase-js';
export const useAuth=()=>{const[session,setSession]=useState<Session|null>(null);const[loading,setLoading]=useState(true);useEffect(()=>{const{data:{subscription}}=supabase.auth.onAuthStateChange((_event,next)=>{setSession(next);setLoading(false);});supabase.auth.getSession().then(({data:{session:current}})=>{setSession(current);setLoading(false);});return()=>subscription.unsubscribe();},[]);const signOut=async()=>{try{await supabase.auth.signOut({scope:'local'});}finally{setSession(null);window.location.replace('/auth');}};return{session,loading,signOut};};
