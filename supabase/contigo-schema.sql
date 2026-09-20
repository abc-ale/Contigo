-- Contigo · esquema para Supabase
-- Ejecuta este archivo completo en Supabase > SQL Editor.
-- Está pensado para una base nueva. Si ya tienes tablas de una versión anterior,
-- respalda primero y revisa los nombres antes de ejecutarlo.

create extension if not exists pgcrypto;

do $$ begin
  create type user_role as enum ('CLIENTE_DECISOR', 'PERSONAL_ACOMPANANTE', 'ADMINISTRADOR');
exception when duplicate_object then null; end $$;

do $$ begin
  create type worker_status as enum ('DISPONIBLE', 'EN_SERVICIO', 'INACTIVO');
exception when duplicate_object then null; end $$;

do $$ begin
  create type request_status as enum ('SOLICITADO', 'ASIGNADO', 'EN_CURSO', 'FINALIZADO', 'CANCELADO');
exception when duplicate_object then null; end $$;

do $$ begin
  create type service_type as enum ('CITA_MEDICA', 'TRAMITE', 'COMPRAS', 'TECNOLOGIA', 'RECREACION');
exception when duplicate_object then null; end $$;

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email varchar(160) unique not null,
  password varchar(100) not null,
  role user_role not null default 'CLIENTE_DECISOR',
  full_name varchar(160) not null,
  phone varchar(30),
  dni varchar(8),
  created_at timestamptz not null default now()
);

create table if not exists senior_persons (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references users(id),
  full_name varchar(160) not null,
  age integer not null check (age between 60 and 130),
  medical_notes text,
  emergency_contact varchar(200),
  created_at timestamptz not null default now()
);

create table if not exists workers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique not null references users(id),
  skills text,
  background_checked boolean not null default false,
  status worker_status not null default 'DISPONIBLE',
  created_at timestamptz not null default now()
);

create table if not exists service_requests (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references users(id),
  senior_id uuid not null references senior_persons(id),
  worker_id uuid references workers(id),
  service_type service_type not null,
  status request_status not null default 'SOLICITADO',
  scheduled_at timestamptz not null,
  duration_hours numeric(4,1) not null check (duration_hours > 0 and duration_hours <= 24),
  pickup_address varchar(300) not null,
  destination_address varchar(300),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists reviews (
  id uuid primary key default gen_random_uuid(),
  request_id uuid unique not null references service_requests(id),
  rating integer not null check (rating between 1 and 5),
  comment text,
  created_at timestamptz not null default now()
);

create index if not exists idx_requests_client on service_requests(client_id, scheduled_at desc);
create index if not exists idx_requests_worker on service_requests(worker_id, scheduled_at desc);
create index if not exists idx_requests_status on service_requests(status);

-- Las políticas RLS quedan desactivadas porque la API usa la conexión PostgreSQL
-- protegida en Render. Nunca expongas la contraseña de PostgreSQL al navegador.

-- Cuentas de prueba solicitadas. Las contraseñas ya están en bcrypt.
insert into users (email, password, role, full_name, phone, dni)
values
  ('admin@contigo.pe', '$2b$10$7acFAzXzBloUr5NBPLE45u8TlwbuR/L3RCRrYUHgT7/X7ui3WuMxi', 'ADMINISTRADOR', 'Admin Contigo', '999999999', '11111111'),
  ('personal@contigo.pe', '$2b$10$IiDejllQt9xypTmLUZsjZe7med.McZhM9YJRUqwrUUzZE3r/aaxbC', 'PERSONAL_ACOMPANANTE', 'Personal Contigo', '988888888', '22222222')
on conflict (email) do update set
  password = excluded.password,
  role = excluded.role,
  full_name = excluded.full_name,
  phone = excluded.phone,
  dni = excluded.dni;

insert into workers (user_id, skills, background_checked, status)
select id, 'Acompañamiento, citas médicas y trámites', true, 'DISPONIBLE'
from users
where email = 'personal@contigo.pe'
on conflict (user_id) do update set
  skills = excluded.skills,
  background_checked = excluded.background_checked,
  status = excluded.status;

-- Registro de cliente de ejemplo opcional.
-- La contraseña del cliente se crea desde la pantalla Registro.