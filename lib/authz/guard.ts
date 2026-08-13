import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
export async function requireUser() { const supabase = await createClient(); const {data:{user}} = await supabase.auth.getUser(); if (!user) redirect('/login'); return user; }
export async function assertPermission(companyId: string, permission: string) { const supabase = await createClient(); const { data, error } = await supabase.rpc('has_permission', { target_company: companyId, permission_key: permission }); if (error || !data) throw new Error('Forbidden'); }
