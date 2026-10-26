-- ==============================================================================
-- MargeUp - Migration 04 : Script de Test et Preuve d'Étanchéité Multi-Tenant & Rôles
-- Vérifie avec 2 entreprises et 3 rôles qu'AUCUNE fuite de données n'est possible,
-- même en cas de requête directe sur les tables / via l'API Supabase.
-- ==============================================================================

create or replace function public.run_margeup_security_tests()
returns table(
    test_num integer,
    test_nom text,
    statut text,
    details text
)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
    v_comp_alpha uuid := gen_random_uuid();
    v_comp_beta  uuid := gen_random_uuid();
    
    v_user_dir_alpha uuid := gen_random_uuid();
    v_user_mag_alpha uuid := gen_random_uuid();
    v_user_tra_alpha uuid := gen_random_uuid();
    v_user_dir_beta  uuid := gen_random_uuid();
    
    v_art_alpha uuid;
    v_art_beta  uuid;
    v_cam_alpha uuid;
    v_cam_beta  uuid;
    v_ch_alpha  uuid;
    v_ch_beta   uuid;
    v_cnt integer;
begin
    -- --------------------------------------------------------------------------
    -- 1. INITIALISATION DES DONNÉES FICTIVES DE TEST (2 Entreprises)
    -- --------------------------------------------------------------------------
    insert into public.entreprises (id, nom, ville, telephone, email)
    values 
        (v_comp_alpha, 'Entreprise Alpha BTP Dakar', 'Dakar', '770000001', 'alpha@test.margeup.sn'),
        (v_comp_beta,  'Entreprise Beta BTP Thiès', 'Thiès', '770000002', 'beta@test.margeup.sn');

    -- Membres Entreprise Alpha
    insert into public.membres (company_id, user_id, role, nom, email, telephone)
    values
        (v_comp_alpha, v_user_dir_alpha, 'direction',  'Patron Alpha',     'dir.alpha@test.sn', '771110001'),
        (v_comp_alpha, v_user_mag_alpha, 'magasinier', 'Magasinier Alpha', 'mag.alpha@test.sn', '771110002'),
        (v_comp_alpha, v_user_tra_alpha, 'transport',  'Transport Alpha',  'tra.alpha@test.sn', '771110003');

    -- Membre Entreprise Beta
    insert into public.membres (company_id, user_id, role, nom, email, telephone)
    values
        (v_comp_beta,  v_user_dir_beta,  'direction',  'Patron Beta',      'dir.beta@test.sn',  '772220001');

    -- Données Métier Alpha
    insert into public.articles (company_id, nom, unite, stock_actuel, prix_detail)
    values (v_comp_alpha, 'Ciment Dangote Alpha', 'tonne', 20, 4250) returning id into v_art_alpha;

    insert into public.camions (company_id, nom, immatriculation, chauffeur_nom)
    values (v_comp_alpha, 'Shacman Alpha', 'DK-0001-AA', 'Chauffeur Modou') returning id into v_cam_alpha;

    insert into public.chantiers (company_id, nom, budget_alloue)
    values (v_comp_alpha, 'Chantier Tour Alpha', 50000000) returning id into v_ch_alpha;

    -- Données Métier Beta
    insert into public.articles (company_id, nom, unite, stock_actuel, prix_detail)
    values (v_comp_beta, 'Fer à béton Beta', 'barre', 100, 3500) returning id into v_art_beta;

    insert into public.camions (company_id, nom, immatriculation, chauffeur_nom)
    values (v_comp_beta, 'Volvo Benne Beta', 'TH-9999-BB', 'Chauffeur Ibra') returning id into v_cam_beta;

    insert into public.chantiers (company_id, nom, budget_alloue)
    values (v_comp_beta, 'Chantier Pont Beta', 80000000) returning id into v_ch_beta;

    -- --------------------------------------------------------------------------
    -- TEST 1 : ÉTANCHÉITÉ MULTI-TENANT (Alpha ne voit JAMAIS Beta)
    -- --------------------------------------------------------------------------
    -- Simulation utilisateur : Direction Alpha
    perform set_config('request.jwt.claim.sub', v_user_dir_alpha::text, true);

    select count(*) into v_cnt from public.articles where company_id = v_comp_beta;
    if v_cnt = 0 then
        test_num := 1; test_nom := 'Étanchéité Multi-Tenant (Articles)'; statut := 'PASS';
        details := 'Direction Alpha ne peut lire aucun article de Entreprise Beta.';
        return next;
    else
        test_num := 1; test_nom := 'Étanchéité Multi-Tenant (Articles)'; statut := 'FAIL';
        details := 'FUITE : Direction Alpha a pu voir des articles de Beta !';
        return next;
    end if;

    select count(*) into v_cnt from public.camions where company_id = v_comp_beta;
    if v_cnt = 0 then
        test_num := 2; test_nom := 'Étanchéité Multi-Tenant (Flotte Camions)'; statut := 'PASS';
        details := 'Direction Alpha ne peut lire aucun camion de Entreprise Beta.';
        return next;
    else
        test_num := 2; test_nom := 'Étanchéité Multi-Tenant (Flotte Camions)'; statut := 'FAIL';
        details := 'FUITE : Direction Alpha a pu voir des camions de Beta !';
        return next;
    end if;

    -- --------------------------------------------------------------------------
    -- TEST 3 : CLOISONNEMENT MAGASINIER (Pas d'accès flotte ni finances)
    -- --------------------------------------------------------------------------
    -- Simulation utilisateur : Magasinier Alpha
    perform set_config('request.jwt.claim.sub', v_user_mag_alpha::text, true);

    select count(*) into v_cnt from public.camions;
    if v_cnt = 0 then
        test_num := 3; test_nom := 'Isolation Rôle Magasinier (Flotte Camions)'; statut := 'PASS';
        details := 'Le Magasinier est strictement bloqué en lecture sur la flotte de camions.';
        return next;
    else
        test_num := 3; test_nom := 'Isolation Rôle Magasinier (Flotte Camions)'; statut := 'FAIL';
        details := 'FUITE : Le Magasinier a pu lire la table des camions.';
        return next;
    end if;

    select count(*) into v_cnt from public.abonnements;
    if v_cnt = 0 then
        test_num := 4; test_nom := 'Isolation Rôle Magasinier (Finances & Abonnements)'; statut := 'PASS';
        details := 'Le Magasinier ne peut pas accéder aux abonnements et finances globales.';
        return next;
    else
        test_num := 4; test_nom := 'Isolation Rôle Magasinier (Finances & Abonnements)'; statut := 'FAIL';
        details := 'FUITE : Le Magasinier a accédé aux données d abonnement.';
        return next;
    end if;

    -- --------------------------------------------------------------------------
    -- TEST 5 : CLOISONNEMENT TRANSPORT (Pas d'accès aux ventes ni quincaillerie)
    -- --------------------------------------------------------------------------
    -- Simulation utilisateur : Transport Alpha
    perform set_config('request.jwt.claim.sub', v_user_tra_alpha::text, true);

    select count(*) into v_cnt from public.articles;
    if v_cnt = 0 then
        test_num := 5; test_nom := 'Isolation Rôle Transport (Quincaillerie & Articles)'; statut := 'PASS';
        details := 'Le Responsable Transport ne voit aucun article ni stock de quincaillerie.';
        return next;
    else
        test_num := 5; test_nom := 'Isolation Rôle Transport (Quincaillerie & Articles)'; statut := 'FAIL';
        details := 'FUITE : Le Transport a pu lire les articles de quincaillerie.';
        return next;
    end if;

    select count(*) into v_cnt from public.ventes;
    if v_cnt = 0 then
        test_num := 6; test_nom := 'Isolation Rôle Transport (Ventes & Caisse)'; statut := 'PASS';
        details := 'Le Responsable Transport ne voit aucune vente ni chiffre de caisse.';
        return next;
    else
        test_num := 6; test_nom := 'Isolation Rôle Transport (Ventes & Caisse)'; statut := 'FAIL';
        details := 'FUITE : Le Transport a accédé aux factures et ventes.';
        return next;
    end if;

    -- --------------------------------------------------------------------------
    -- TEST 7 : JOURNAL D'AUDIT AUTOMATIQUE
    -- --------------------------------------------------------------------------
    select count(*) into v_cnt from public.journal_audit where company_id = v_comp_alpha;
    if v_cnt > 0 then
        test_num := 7; test_nom := 'Déclencheurs Journal d Audit'; statut := 'PASS';
        details := 'Les déclencheurs ont automatiquement consigné les écritures dans journal_audit (' || v_cnt || ' entrées).';
        return next;
    else
        test_num := 7; test_nom := 'Déclencheurs Journal d Audit'; statut := 'FAIL';
        details := 'Le journal d audit n a enregistré aucun événement.';
        return next;
    end if;

    -- Nettoyage des données de test
    delete from public.entreprises where id in (v_comp_alpha, v_comp_beta);

    return;
end;
$$;
