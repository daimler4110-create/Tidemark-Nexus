import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
export default async function Home(){ const supabase=await createClient(); const {data:{user}}=await supabase.auth.getUser(); if(!user) redirect('/login'); const {data}=await supabase.from('companies').select('slug').limit(1); if(data?.[0]) redirect(`/c/${data[0].slug}/dashboard`); return <main className="shell"><h1>Tidemark Nexus</h1><p>Your account has no active company membership. Contact an administrator.</p></main>; }
