-- ==============================================================================
-- MargeUp - Migration 02 : Déclencheurs Automatiques de Journal d'Audit
-- Enregistre automatiquement toute création, modification et suppression
-- avec ancienne valeur, nouvelle valeur, auteur et horodatage.
-- ==============================================================================

create or replace function public.process_audit_log()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
    v_company_id uuid;
    v_record_id uuid;
    v_user_id uuid;
    v_user_email text;
    v_old_data jsonb := null;
    v_new_data jsonb := null;
begin
    -- Détermination de l'utilisateur actif
    v_user_id := auth.uid();
    
    begin
        select email into v_user_email from auth.users where id = v_user_id;
    exception when others then
        v_user_email := null;
    end;

    -- Récupération de l'ID d'entreprise et de l'enregistrement
    if (TG_OP = 'DELETE') then
        v_record_id := OLD.id;
        v_company_id := OLD.company_id;
        v_old_data := to_jsonb(OLD);
    elsif (TG_OP = 'UPDATE') then
        v_record_id := NEW.id;
        v_company_id := NEW.company_id;
        v_old_data := to_jsonb(OLD);
        v_new_data := to_jsonb(NEW);
    elsif (TG_OP = 'INSERT') then
        v_record_id := NEW.id;
        v_company_id := NEW.company_id;
        v_new_data := to_jsonb(NEW);
    end if;

    -- Insertion dans le journal d'audit de l'entreprise
    if v_company_id is not null then
        insert into public.journal_audit (
            company_id,
            nom_table,
            record_id,
            action,
            ancienne_valeur,
            nouvelle_valeur,
            auteur_id,
            auteur_email,
            date_action
        ) values (
            v_company_id,
            TG_TABLE_NAME,
            v_record_id,
            TG_OP,
            v_old_data,
            v_new_data,
            v_user_id,
            v_user_email,
            now()
        );
    end if;

    if (TG_OP = 'DELETE') then
        return OLD;
    else
        return NEW;
    end if;
end;
$$;

-- Application des déclencheurs sur chaque table métier critique

-- 1. Articles
drop trigger if exists trg_audit_articles on public.articles;
create trigger trg_audit_articles
after insert or update or delete on public.articles
for each row execute function public.process_audit_log();

-- 2. Ventes
drop trigger if exists trg_audit_ventes on public.ventes;
create trigger trg_audit_ventes
after insert or update or delete on public.ventes
for each row execute function public.process_audit_log();

-- 3. Lignes de Vente
drop trigger if exists trg_audit_lignes_vente on public.lignes_vente;
create trigger trg_audit_lignes_vente
after insert or update or delete on public.lignes_vente
for each row execute function public.process_audit_log();

-- 4. Mouvements de Stock
drop trigger if exists trg_audit_mouvements_stock on public.mouvements_stock;
create trigger trg_audit_mouvements_stock
after insert or update or delete on public.mouvements_stock
for each row execute function public.process_audit_log();

-- 5. Chantiers
drop trigger if exists trg_audit_chantiers on public.chantiers;
create trigger trg_audit_chantiers
after insert or update or delete on public.chantiers
for each row execute function public.process_audit_log();

-- 6. Phases de Chantier
drop trigger if exists trg_audit_phases_chantier on public.phases_chantier;
create trigger trg_audit_phases_chantier
after insert or update or delete on public.phases_chantier
for each row execute function public.process_audit_log();

-- 7. Camions
drop trigger if exists trg_audit_camions on public.camions;
create trigger trg_audit_camions
after insert or update or delete on public.camions
for each row execute function public.process_audit_log();

-- 8. Pleins de Carburant
drop trigger if exists trg_audit_pleins on public.pleins;
create trigger trg_audit_pleins
after insert or update or delete on public.pleins
for each row execute function public.process_audit_log();

-- 9. Voyages
drop trigger if exists trg_audit_voyages on public.voyages;
create trigger trg_audit_voyages
after insert or update or delete on public.voyages
for each row execute function public.process_audit_log();

-- 10. Pannes
drop trigger if exists trg_audit_pannes on public.pannes;
create trigger trg_audit_pannes
after insert or update or delete on public.pannes
for each row execute function public.process_audit_log();

-- 11. Abonnements
drop trigger if exists trg_audit_abonnements on public.abonnements;
create trigger trg_audit_abonnements
after insert or update or delete on public.abonnements
for each row execute function public.process_audit_log();
