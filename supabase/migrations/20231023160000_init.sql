-- Migration: init.sql – Core tables for MargeUp
-- Generated on 2026-10-23

-- Enable the pgcrypto extension for UUID generation
create extension if not exists pgcrypto;

-- 1. Sites (dépos / chantiers)
create table public.sites (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    type text check (type in ('depot','chantier')) not null,
    address text,
    created_at timestamp with time zone default now(),
    updated_at timestamp with time zone default now()
);

-- 2. Projects (chantier business)
create table public.projects (
    id uuid primary key default gen_random_uuid(),
    site_id uuid references public.sites(id) on delete cascade,
    name text not null,
    budget numeric(15,2),
    start_date date,
    end_date date,
    created_at timestamp with time zone default now(),
    updated_at timestamp with time zone default now()
);

-- 3. Financial entries (marges, recettes, dépenses)
create table public.financial_entries (
    id uuid primary key default gen_random_uuid(),
    project_id uuid references public.projects(id) on delete cascade,
    type text check (type in ('margin','revenue','expense')) not null,
    amount numeric(15,2) not null,
    entry_date date not null,
    created_at timestamp with time zone default now()
);

-- 4. Vehicles (camions)
create table public.vehicles (
    id uuid primary key default gen_random_uuid(),
    plate text not null unique,
    model text,
    capacity_liters numeric(10,2),
    created_at timestamp with time zone default now()
);

-- 5. Drivers (chauffeurs)
create table public.drivers (
    id uuid primary key default gen_random_uuid(),
    user_id uuid references auth.users(id) on delete cascade,
    name text not null,
    license_number text,
    created_at timestamp with time zone default now()
);

-- 6. Fuel logs (plein de carburant)
create table public.fuel_logs (
    id uuid primary key default gen_random_uuid(),
    vehicle_id uuid references public.vehicles(id) on delete cascade,
    driver_id uuid references public.drivers(id) on delete set null,
    log_date date not null,
    liters numeric(10,2) not null,
    amount_fcfa numeric(15,2) not null,
    odometer_km numeric(12,2),
    created_at timestamp with time zone default now()
);

-- 7. Trips (rotations)
create table public.trips (
    id uuid primary key default gen_random_uuid(),
    vehicle_id uuid references public.vehicles(id) on delete cascade,
    driver_id uuid references public.drivers(id) on delete set null,
    trip_date date not null,
    origin_site_id uuid references public.sites(id) on delete set null,
    dest_site_id uuid references public.sites(id) on delete set null,
    distance_km numeric(12,2) not null,
    fuel_log_id uuid references public.fuel_logs(id) on delete set null,
    created_at timestamp with time zone default now()
);

-- 8. Breakdowns (pannes)
create table public.breakdowns (
    id uuid primary key default gen_random_uuid(),
    vehicle_id uuid references public.vehicles(id) on delete cascade,
    breakdown_date date not null,
    severity text check (severity in ('low','medium','high')) not null,
    cost_fcfa numeric(15,2),
    description text,
    created_at timestamp with time zone default now()
);

-- 9. Materials (quincaillerie)
create table public.materials (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    unit text not null,
    stock_qty numeric(12,2) default 0,
    created_at timestamp with time zone default now()
);

-- 10. Sales (ventes B2C/B2B)
create table public.sales (
    id uuid primary key default gen_random_uuid(),
    material_id uuid references public.materials(id) on delete cascade,
    sale_type text check (sale_type in ('B2C','B2B')) not null,
    quantity numeric(12,2) not null,
    price_fcfa numeric(15,2) not null,
    sale_date date not null,
    site_id uuid references public.sites(id) on delete set null,
    receipt_path text,
    created_at timestamp with time zone default now()
);

-- 11. Reviews (avis & témoignages)
create table public.reviews (
    id uuid primary key default gen_random_uuid(),
    user_id uuid references auth.users(id) on delete cascade,
    project_id uuid references public.projects(id) on delete cascade,
    rating smallint check (rating >= 1 and rating <= 5) not null,
    comment text,
    review_date date default current_date,
    created_at timestamp with time zone default now()
);

-- Indexes for performant look‑ups
create index idx_projects_site_id on public.projects(site_id);
create index idx_financial_entries_project_id on public.financial_entries(project_id);
create index idx_fuel_logs_vehicle_id on public.fuel_logs(vehicle_id);
create index idx_trips_vehicle_id on public.trips(vehicle_id);
create index idx_trips_driver_id on public.trips(driver_id);
create index idx_breakdowns_vehicle_id on public.breakdowns(vehicle_id);
create index idx_sales_material_id on public.sales(material_id);
create index idx_sales_site_id on public.sales(site_id);
create index idx_reviews_user_id on public.reviews(user_id);
create index idx_reviews_project_id on public.reviews(project_id);

-- Optional materialised view for dashboard aggregates (example)
create materialized view public.dashboard_metrics as
select
    p.id as project_id,
    sum(case when fe.type = 'revenue' then fe.amount else 0 end) as total_revenue,
    sum(case when fe.type = 'expense' then fe.amount else 0 end) as total_expense,
    sum(case when fe.type = 'margin' then fe.amount else 0 end) as total_margin
from public.projects p
left join public.financial_entries fe on fe.project_id = p.id
group by p.id;

-- Refresh policy (could be scheduled with an Edge Function)
create or replace function public.refresh_dashboard_metrics()
returns void language plpgsql as $$
begin
    refresh materialized view public.dashboard_metrics;
end;
$$;

-- Grant public read access (Supabase Realtime will expose the tables)
grant select on all tables in schema public to anon;
grant insert, update, delete on all tables in schema public to service_role;

-- End of migration
