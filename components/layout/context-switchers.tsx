"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Company, Workspace } from "@/lib/db/models";

export function CompanySwitcher({ companies, activeSlug }: { companies: Company[]; activeSlug: string }) {
  const router = useRouter();
  return <label className="switcher">Company<select aria-label="Active company" value={activeSlug} onChange={(event) => router.push(`/c/${event.target.value}/dashboard`)}>{companies.map((company) => <option key={company.id} value={company.slug}>{company.name}</option>)}</select><span className="switcher-links">{companies.filter((company) => company.slug !== activeSlug).map((company) => <Link key={company.id} href={`/c/${company.slug}/dashboard`}>Switch to {company.name}</Link>)}</span></label>;
}

export function WorkspaceSwitcher({ workspaces, companySlug }: { workspaces: Workspace[]; companySlug: string }) {
  const router = useRouter();
  if (workspaces.length === 0) return null;
  return <label className="switcher">Workspace<select aria-label="Active workspace" defaultValue="" onChange={(event) => { if (event.target.value) router.push(`/c/${companySlug}/w/${event.target.value}`); }}><option value="">Company-wide</option>{workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}</select><span className="switcher-links">{workspaces.map((workspace) => <Link key={workspace.id} href={`/c/${companySlug}/w/${workspace.id}`}>{workspace.name}</Link>)}</span></label>;
}
