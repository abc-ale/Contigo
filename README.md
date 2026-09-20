# Contigo

Contigo es una plataforma de acompañamiento para adultos mayores. El cliente
crea su cuenta y solicita servicios; el administrador registra trabajadores,
asigna solicitudes, consulta los servicios y descarga un respaldo en Excel.
Los clientes pueden calificar cada servicio finalizado de 1 a 5 estrellas.

## Requisitos

- Node.js 20 o 24
- pnpm 10
- Un proyecto de Supabase con PostgreSQL

## Ejecutar en local

1. Instala pnpm si todavía no lo tienes:

   ```bash
   corepack enable
   corepack prepare pnpm@10.26.1 --activate
   ```

2. Instala dependencias:

   ```bash
   pnpm install
   ```

3. Crea `./.env` copiando `.env.example` y coloca la cadena `DATABASE_URL`
   de Supabase. Define también un `SESSION_SECRET` largo.

4. Crea las tablas y las cuentas iniciales en Supabase:

   - Abre **Supabase > SQL Editor**.
   - Copia y ejecuta todo el archivo `supabase/contigo-schema.sql`.
   - Las cuentas iniciales son `admin@contigo.pe` y `personal@contigo.pe`.
   - El archivo conserva las contraseñas bcrypt solicitadas; no las cambies
     desde el navegador.

5. Inicia los servicios en dos terminales:

   ```bash
   pnpm --filter @workspace/api-server run dev
   pnpm --filter @workspace/contigo-platform run dev
   ```

   Abre la URL que muestre Vite. La API queda disponible en `/api`.

## Flujo de permisos

- **Registro público:** solo crea usuarios `CLIENTE_DECISOR`. No existe un
  selector de rol para evitar que alguien se registre como administrador o
  trabajador.
- **Administrador:** entra con `admin@contigo.pe`, registra trabajadores,
  consulta solicitudes, asigna personal, actualiza estados y descarga
  `contigo-solicitudes.xlsx`.
- **Cliente:** crea adultos mayores, solicita servicios y califica servicios
  finalizados.
- **Personal acompañante:** entra con `personal@contigo.pe`, revisa sus
  servicios y actualiza estados.

## Contrato y comprobaciones

```bash
pnpm --filter @workspace/api-spec run codegen
pnpm run typecheck
PORT=5173 BASE_PATH=/ pnpm --filter @workspace/contigo-platform run build
pnpm --filter @workspace/api-server run build
```

## Publicar gratis en Render

1. Sube este repositorio a GitHub.
2. En Render selecciona **New > Blueprint** y conecta el repositorio.
3. Render detectará `render.yaml` y creará el servicio gratuito.
4. En el formulario de Render completa `DATABASE_URL` con la cadena de
   conexión de Supabase. No la pegues en archivos ni en el frontend.
5. Render generará `SESSION_SECRET` automáticamente.
6. Pulsa **Apply**. El servicio compila el frontend y el backend en un solo
   proceso y atiende `/api/healthz` como health check.

El plan gratuito de Render puede suspender el servicio después de un periodo
sin tráfico; el primer acceso posterior puede tardar unos segundos.

## Seguridad

- `DATABASE_URL` y `SESSION_SECRET` son secretos del servidor.
- No publiques la contraseña de Supabase ni la clave `service_role`.
- Si una contraseña fue expuesta en un archivo anterior, rótala desde Supabase
  antes de publicar.