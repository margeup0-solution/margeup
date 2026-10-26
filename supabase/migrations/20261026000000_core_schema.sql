-- ==============================================================================
-- MargeUp - Migration 01 : Schéma Fondamental Multi-Tenant
-- Tables : entreprises, membres, clients, articles, mouvements_stock,
--          ventes, lignes_vente, camions, pleins, voyages, pannes,
--          chantiers, phases_chantier, journal_audit, abonnements
-- Chaque table porte company_id obligatoire.
-- ==============================================================================

-- Extensions
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- Nettoyage de l'ancienne fonction vulnérable mentionnée dans l'audit
drop function if exists public.rls_auto_enable() cascade;
drop function if exists public.rls_auto_enable cascade;

-- 1. Table ENTREPRISES
create table if not exists public.entreprises (
    id uuid primary key default gen_random_uuid(),
    nom text not null,
    adresse text,
    ville text,
    telephone text not null,
    email text not null,
    responsable_nom text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- 2. Table MEMBRES (avec lien vers auth.users et rôle strict)
create table if not exists public.membres (
    id uuid primary key default gen_random_uuid(),
    company_id uuid not null references public.entreprises(id) on delete cascade,
    user_id uuid references auth.users(id) on delete set null,
    role text not null check (role in ('direction', 'magasinier', 'transport')),
    nom text not null,
    email text not null,
    telephone text not null,
    scope_type text check (scope_type in ('all', 'chantier', 'depot', 'truck')),
    scope_id text,
    actif boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique(company_id, email)
);

-- 3. Table CLIENTS
create table if not exists public.clients (
    id uuid primary key default gen_random_uuid(),
    company_id uuid not null references public.entreprises(id) on delete cascade,
    nom text not null,
    telephone text,
    email text,
    type text not null default 'particulier' check (type in ('particulier', 'entreprise')),
    adresse text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- 4. Table ARTICLES (Quincaillerie)
create table if not exists public.articles (
    id uuid primary key default gen_random_uuid(),
    company_id uuid not null references public.entreprises(id) on delete cascade,
    nom text not null,
    categorie text not null default 'Divers',
    unite text not null default 'unités',
    stock_actuel numeric(12,3) not null default 0 check (stock_actuel >= 0),
    prix_detail numeric(15,2) not null default 0 check (prix_detail >= 0),
    prix_gros numeric(15,2) not null default 0 check (prix_gros >= 0),
    seuil_alerte numeric(12,3) not null default 5,
    depot text not null default 'Quincaillerie principale',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- 5. Table VENTES
create table if not exists public.ventes (
    id uuid primary key default gen_random_uuid(),
    company_id uuid not null references public.entreprises(id) on delete cascade,
    numero_facture text not null,
    client_id uuid references public.clients(id) on delete set null,
    client_nom text not null,
    client_tel text,
    type_vente text not null default 'detail' check (type_vente in ('detail', 'gros')),
    statut_paiement text not null default 'paye' check (statut_paiement in ('paye', 'en_attente', 'credit')),
    mode_paiement text not null default 'Espèces' check (mode_paiement in ('Espèces', 'Wave', 'Orange Money', 'Crédit', 'Virement', 'Chèque')),
    montant_total numeric(15,2) not null default 0 check (montant_total >= 0),
    depot text not null default 'Quincaillerie principale',
    auteur_id uuid references auth.users(id) on delete set null,
    date_vente date not null default current_date,
    created_at timestamptz not null default now(),
    unique(company_id, numero_facture)
);

-- 6. Table LIGNES_VENTE
create table if not exists public.lignes_vente (
    id uuid primary key default gen_random_uuid(),
    company_id uuid not null references public.entreprises(id) on delete cascade,
    vente_id uuid not null references public.ventes(id) on delete cascade,
    article_id uuid references public.articles(id) on delete set null,
    nom_article text not null,
    unite text not null,
    quantite numeric(12,3) not null check (quantite > 0),
    prix_unitaire numeric(15,2) not null check (prix_unitaire >= 0),
    montant_total numeric(15,2) not null check (montant_total >= 0),
    created_at timestamptz not null default now()
);

-- 7. Table CHANTIERS
create table if not exists public.chantiers (
    id uuid primary key default gen_random_uuid(),
    company_id uuid not null references public.entreprises(id) on delete cascade,
    nom text not null,
    budget_alloue numeric(15,2) not null default 0 check (budget_alloue >= 0),
    statut text not null default 'actif' check (statut in ('actif', 'livre', 'suspendu')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- 8. Table PHASES_CHANTIER (Suivi gros œuvre & bâtiments)
create table if not exists public.phases_chantier (
    id uuid primary key default gen_random_uuid(),
    company_id uuid not null references public.entreprises(id) on delete cascade,
    chantier_id uuid not null references public.chantiers(id) on delete cascade,
    nom_batiment text not null,
    niveaux integer default 1 check (niveaux >= 0),
    niveau_actuel integer default 0 check (niveau_actuel >= 0),
    ingenieur_nom text,
    chef_chantier_nom text,
    date_debut date,
    date_previsionnelle date,
    date_livraison date,
    phases jsonb not null default '{}'::jsonb,
    note text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- 9. Table MOUVEMENTS_STOCK
create table if not exists public.mouvements_stock (
    id uuid primary key default gen_random_uuid(),
    company_id uuid not null references public.entreprises(id) on delete cascade,
    article_id uuid not null references public.articles(id) on delete cascade,
    type_mouvement text not null check (type_mouvement in ('entree', 'sortie_chantier', 'vente', 'ajustement')),
    quantite numeric(12,3) not null,
    unite text not null,
    chantier_id uuid references public.chantiers(id) on delete set null,
    vente_id uuid references public.ventes(id) on delete set null,
    auteur_id uuid references auth.users(id) on delete set null,
    details text,
    date_mouvement timestamptz not null default now(),
    created_at timestamptz not null default now()
);

-- 10. Table CAMIONS (Flotte)
create table if not exists public.camions (
    id uuid primary key default gen_random_uuid(),
    company_id uuid not null references public.entreprises(id) on delete cascade,
    nom text not null,
    immatriculation text not null,
    chauffeur_nom text not null,
    type_vehicule text not null default 'benne' check (type_vehicule in ('benne', 'tracteur', 'toupie')),
    statut text not null default 'disponible' check (statut in ('disponible', 'en_mission', 'en_panne')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique(company_id, immatriculation)
);

-- 11. Table PLEINS (Carburant)
create table if not exists public.pleins (
    id uuid primary key default gen_random_uuid(),
    company_id uuid not null references public.entreprises(id) on delete cascade,
    camion_id uuid not null references public.camions(id) on delete cascade,
    date_plein date not null default current_date,
    litres numeric(10,2) not null check (litres > 0),
    montant_fcfa numeric(15,2) not null check (montant_fcfa >= 0),
    compteur_km numeric(12,2),
    station text,
    chantier_id uuid references public.chantiers(id) on delete set null,
    auteur_id uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now()
);

-- 12. Table VOYAGES (Rotations et transports)
create table if not exists public.voyages (
    id uuid primary key default gen_random_uuid(),
    company_id uuid not null references public.entreprises(id) on delete cascade,
    camion_id uuid not null references public.camions(id) on delete cascade,
    date_voyage date not null default current_date,
    nombre_tours integer not null default 1 check (nombre_tours > 0),
    lieu_depart text not null,
    lieu_arrivee text not null,
    distance_km numeric(10,2) not null default 0 check (distance_km >= 0),
    marchandise text,
    chauffeur_nom text,
    auteur_id uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now()
);

-- 13. Table PANNES
create table if not exists public.pannes (
    id uuid primary key default gen_random_uuid(),
    company_id uuid not null references public.entreprises(id) on delete cascade,
    camion_id uuid not null references public.camions(id) on delete cascade,
    date_panne date not null default current_date,
    diagnostic text not null,
    gravite text not null default 'Moyenne' check (gravite in ('Faible', 'Moyenne', 'Critique')),
    statut text not null default 'en_cours' check (statut in ('en_cours', 'attente_piece', 'termine')),
    cout_fcfa numeric(15,2) not null default 0 check (cout_fcfa >= 0),
    chauffeur_nom text,
    auteur_id uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- 14. Table ABONNEMENTS
create table if not exists public.abonnements (
    id uuid primary key default gen_random_uuid(),
    company_id uuid not null references public.entreprises(id) on delete cascade,
    plan text not null check (plan in ('b2c_detail', 'hybride', 'flotte_camions')),
    statut text not null default 'essai' check (statut in ('essai', 'actif', 'en_verification', 'suspendu', 'expire')),
    date_debut date not null default current_date,
    date_fin date not null,
    montant_fcfa numeric(15,2) not null default 0,
    methode_paiement text check (methode_paiement in ('Wave', 'Orange Money', 'Virement', 'Espèces')),
    reference_paiement text,
    telephone_paiement text,
    camions_inclus integer default 0,
    quincailleries_incluses integer default 1,
    chantiers_inclus integer default 1,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- 15. Table JOURNAL_AUDIT
create table if not exists public.journal_audit (
    id uuid primary key default gen_random_uuid(),
    company_id uuid not null references public.entreprises(id) on delete cascade,
    nom_table text not null,
    record_id uuid not null,
    action text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
    ancienne_valeur jsonb,
    nouvelle_valeur jsonb,
    auteur_id uuid references auth.users(id) on delete set null,
    auteur_email text,
    date_action timestamptz not null default now()
);

-- Index de performance multi-tenant (toutes les requêtes filtrent par company_id)
create index if not exists idx_membres_company on public.membres(company_id, user_id);
create index if not exists idx_articles_company on public.articles(company_id);
create index if not exists idx_mouvements_company on public.mouvements_stock(company_id, article_id);
create index if not exists idx_ventes_company on public.ventes(company_id, date_vente);
create index if not exists idx_lignes_vente_company on public.lignes_vente(company_id, vente_id);
create index if not exists idx_camions_company on public.camions(company_id);
create index if not exists idx_pleins_company on public.pleins(company_id, camion_id);
create index if not exists idx_voyages_company on public.voyages(company_id, camion_id);
create index if not exists idx_pannes_company on public.pannes(company_id, camion_id);
create index if not exists idx_chantiers_company on public.chantiers(company_id);
create index if not exists idx_phases_chantier_company on public.phases_chantier(company_id, chantier_id);
create index if not exists idx_journal_audit_company on public.journal_audit(company_id, nom_table, date_action);
