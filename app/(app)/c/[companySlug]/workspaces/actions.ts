"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { assertPermission, requireUser } from "@/lib/authz/guard";
import { logAuditEvent } from "@/lib/audit/log";
import { workspaceSchema } from "@/lib/validation/workspace";
export async function createWorkspace(companyId:string,companySlug:string,formData:FormData){const user=await requireUser();await assertPermission(companyId,'workspace.manage');const parsed=workspaceSchema.safeParse({name:formData.get('name'),slug:formData.get('slug')});if(!parsed.success)throw new Error('Invalid workspace data');const supabase=await createClient();const {data:workspace,error}=await supabase.from('workspaces').insert({...parsed.data,company_id:companyId,created_by:user.id}).select('id').single();if(error)throw new Error(error.message);await logAuditEvent({actorId:user.id,companyId,action:'workspace.created',resourceType:'workspace',resourceId:workspace.id,after:parsed.data});revalidatePath(`/c/${companySlug}/workspaces`)}
