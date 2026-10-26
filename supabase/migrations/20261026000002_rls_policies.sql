-- ==============================================================================
-- MargeUp - Migration 03 : Politiques de Sécurité RLS Stricte (Multi-Tenant & Rôles)
-- Active la Row Level Security (RLS) sur 100% des tables.
-- Cloisonnement strict par company_id et par rôle :
-- - Direction : lecture et gestion complètes de son entreprise.
-- - Magasinier : quincaillerie, stock, caisse, ventes (aucun accès finances/flotte).
-- - Transport : camions, pleins, voyages, pannes (aucun accès ventes/finances).
-- ==============================================================================

-- 1. Fonctions d'identification sécurisées (SECURITY DEFINER)
create or replace function public.current_user_company_id()
returns uuid
language sql
stable
security definer
set search_path = public, auth
as $$
    select company_id from public.membres where user_id = auth.uid() and actif = true limit 1;
$$;

create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public, auth
as $$
    select role from public.membres where user_id = auth.uid() and actif = true limit 1;
$$;

-- 2. Activation de la RLS sur TOUTES les tables sans exception
alter table public.entreprises enable row level security;
alter table public.membres enable row level security;
alter table public.clients enable row level security;
alter table public.articles enable row level security;
alter table public.mouvements_stock enable row level security;
alter table public.ventes enable row level security;
alter table public.lignes_vente enable row level security;
alter table public.chantiers enable row level security;
alter table public.phases_chantier enable row level security;
alter table public.camions enable row level security;
alter table public.pleins enable row level security;
alter table public.voyages enable row level security;
alter table public.pannes enable row level security;
alter table public.abonnements enable row level security;
alter table public.journal_audit enable row level security;

-- ------------------------------------------------------------------------------
-- 3. POLITIQUES : ENTREPRISES
-- ------------------------------------------------------------------------------
create policy "entreprises_select_own"
on public.entreprises for select
using (id = public.current_user_company_id());

create policy "entreprises_update_direction"
on public.entreprises for update
using (id = public.current_user_company_id() and public.current_user_role() = 'direction')
with check (id = public.current_user_company_id() and public.current_user_role() = 'direction');

-- ------------------------------------------------------------------------------
-- 4. POLITIQUES : MEMBRES
-- ------------------------------------------------------------------------------
create policy "membres_select"
on public.membres for select
using (
    company_id = public.current_user_company_id() and (
        public.current_user_role() = 'direction' or user_id = auth.uid()
    )
);

create policy "membres_insert_direction"
on public.membres for insert
with check (company_id = public.current_user_company_id() and public.current_user_role() = 'direction');

create policy "membres_update_direction"
on public.membres for update
using (company_id = public.current_user_company_id() and public.current_user_role() = 'direction')
with check (company_id = public.current_user_company_id() and public.current_user_role() = 'direction');

create policy "membres_delete_direction"
on public.membres for delete
using (company_id = public.current_user_company_id() and public.current_user_role() = 'direction');

-- ------------------------------------------------------------------------------
-- 5. POLITIQUES : CLIENTS
-- Accessible uniquement à la Direction et au Magasinier de la même entreprise
-- ------------------------------------------------------------------------------
create policy "clients_select_magasinier_direction"
on public.clients for select
using (company_id = public.current_user_company_id() and public.current_user_role() in ('direction', 'magasinier'));

create policy "clients_insert_magasinier_direction"
on public.clients for insert
with check (company_id = public.current_user_company_id() and public.current_user_role() in ('direction', 'magasinier'));

create policy "clients_update_magasinier_direction"
on public.clients for update
using (company_id = public.current_user_company_id() and public.current_user_role() in ('direction', 'magasinier'))
with check (company_id = public.current_user_company_id() and public.current_user_role() in ('direction', 'magasinier'));

-- ------------------------------------------------------------------------------
-- 6. POLITIQUES : ARTICLES (Quincaillerie)
-- Accessible uniquement à la Direction et au Magasinier
-- ------------------------------------------------------------------------------
create policy "articles_select_magasinier_direction"
on public.articles for select
using (company_id = public.current_user_company_id() and public.current_user_role() in ('direction', 'magasinier'));

create policy "articles_insert_magasinier_direction"
on public.articles for insert
with check (company_id = public.current_user_company_id() and public.current_user_role() in ('direction', 'magasinier'));

create policy "articles_update_magasinier_direction"
on public.articles for update
using (company_id = public.current_user_company_id() and public.current_user_role() in ('direction', 'magasinier'))
with check (company_id = public.current_user_company_id() and public.current_user_role() in ('direction', 'magasinier'));

create policy "articles_delete_direction"
on public.articles for delete
using (company_id = public.current_user_company_id() and public.current_user_role() = 'direction');

-- ------------------------------------------------------------------------------
-- 7. POLITIQUES : VENTES & LIGNES_VENTE
-- Accessible uniquement à la Direction et au Magasinier
-- ------------------------------------------------------------------------------
create policy "ventes_select_magasinier_direction"
on public.ventes for select
using (company_id = public.current_user_company_id() and public.current_user_role() in ('direction', 'magasinier'));

create policy "ventes_insert_magasinier_direction"
on public.ventes for insert
with check (company_id = public.current_user_company_id() and public.current_user_role() in ('direction', 'magasinier'));

create policy "lignes_vente_select_magasinier_direction"
on public.lignes_vente for select
using (company_id = public.current_user_company_id() and public.current_user_role() in ('direction', 'magasinier'));

create policy "lignes_vente_insert_magasinier_direction"
on public.lignes_vente for insert
with check (company_id = public.current_user_company_id() and public.current_user_role() in ('direction', 'magasinier'));

-- ------------------------------------------------------------------------------
-- 8. POLITIQUES : MOUVEMENTS_STOCK
-- Direction et Magasinier
-- ------------------------------------------------------------------------------
create policy "mouvements_stock_select_magasinier_direction"
on public.mouvements_stock for select
using (company_id = public.current_user_company_id() and public.current_user_role() in ('direction', 'magasinier'));

create policy "mouvements_stock_insert_magasinier_direction"
on public.mouvements_stock for insert
with check (company_id = public.current_user_company_id() and public.current_user_role() in ('direction', 'magasinier'));

-- ------------------------------------------------------------------------------
-- 9. POLITIQUES : CHANTIERS & PHASES
-- Chantiers : Direction (gestion) + Magasinier (lecture seule pour sortie stock)
-- Phases : Direction uniquement
-- ------------------------------------------------------------------------------
create policy "chantiers_select"
on public.chantiers for select
using (company_id = public.current_user_company_id() and public.current_user_role() in ('direction', 'magasinier'));

create policy "chantiers_all_direction"
on public.chantiers for all
using (company_id = public.current_user_company_id() and public.current_user_role() = 'direction')
with check (company_id = public.current_user_company_id() and public.current_user_role() = 'direction');

create policy "phases_chantier_all_direction"
on public.phases_chantier for all
using (company_id = public.current_user_company_id() and public.current_user_role() = 'direction')
with check (company_id = public.current_user_company_id() and public.current_user_role() = 'direction');

-- ------------------------------------------------------------------------------
-- 10. POLITIQUES : FLOTTE (Camions, Pleins, Voyages, Pannes)
-- Accessible uniquement à la Direction et au Transport (interdit au Magasinier)
-- ------------------------------------------------------------------------------
-- Camions
create policy "camions_select_transport_direction"
on public.camions for select
using (company_id = public.current_user_company_id() and public.current_user_role() in ('direction', 'transport'));

create policy "camions_all_transport_direction"
on public.camions for all
using (company_id = public.current_user_company_id() and public.current_user_role() in ('direction', 'transport'))
with check (company_id = public.current_user_company_id() and public.current_user_role() in ('direction', 'transport'));

-- Pleins
create policy "pleins_select_transport_direction"
on public.pleins for select
using (company_id = public.current_user_company_id() and public.current_user_role() in ('direction', 'transport'));

create policy "pleins_insert_transport_direction"
on public.pleins for insert
with check (company_id = public.current_user_company_id() and public.current_user_role() in ('direction', 'transport'));

-- Voyages
create policy "voyages_select_transport_direction"
on public.voyages for select
using (company_id = public.current_user_company_id() and public.current_user_role() in ('direction', 'transport'));

create policy "voyages_insert_transport_direction"
on public.voyages for insert
with check (company_id = public.current_user_company_id() and public.current_user_role() in ('direction', 'transport'));

-- Pannes
create policy "pannes_select_transport_direction"
on public.pannes for select
using (company_id = public.current_user_company_id() and public.current_user_role() in ('direction', 'transport'));

create policy "pannes_all_transport_direction"
on public.pannes for all
using (company_id = public.current_user_company_id() and public.current_user_role() in ('direction', 'transport'))
with check (company_id = public.current_user_company_id() and public.current_user_role() in ('direction', 'transport'));

-- ------------------------------------------------------------------------------
-- 11. POLITIQUES : ABONNEMENTS & JOURNAL D'AUDIT
-- Réservé exclusivement à la Direction de l'entreprise
-- ------------------------------------------------------------------------------
create policy "abonnements_select_direction"
on public.abonnements for select
using (company_id = public.current_user_company_id() and public.current_user_role() = 'direction');

create policy "abonnements_insert_direction"
on public.abonnements for insert
with check (company_id = public.current_user_company_id() and public.current_user_role() = 'direction');

create policy "journal_audit_select_direction"
on public.journal_audit for select
using (company_id = public.current_user_company_id() and public.current_user_role() = 'direction');

-- Empêcher toute écriture directe dans le journal d'audit (uniquement alimenté par les triggers)
create policy "journal_audit_no_manual_insert"
on public.journal_audit for insert
with check (false);
