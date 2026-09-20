import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import ExcelJS from "exceljs";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  reviews,
  serviceRequests,
  seniors,
  users,
  workers,
} from "@workspace/db/schema";
import {
  AssignRequestBody,
  AssignRequestParams,
  CreateRequestBody,
  CreateReviewBody,
  CreateSeniorBody,
  CreateWorkerBody,
  GetDashboardResponse,
  GetCurrentUserResponse,
  ListRequestsResponse,
  ListSeniorsResponse,
  ListServicesResponse,
  ListWorkersResponse,
  LoginBody,
  RegisterClientBody,
  UpdateRequestStatusBody,
  UpdateRequestStatusParams,
} from "@workspace/api-zod";
import { createToken, requireAuth, requireRole } from "../middlewares/auth";

const router: IRouter = Router();

const SERVICE_LABELS: Record<string, string> = {
  CITA_MEDICA: "Citas médicas",
  TRAMITE: "Trámites y gestiones",
  COMPRAS: "Compras y abastecimiento",
  TECNOLOGIA: "Apoyo tecnológico",
  RECREACION: "Paseos y recreación",
};

const SERVICE_OPTIONS = Object.entries(SERVICE_LABELS).map(([id, label]) => ({
  id,
  label,
  description: {
    CITA_MEDICA: "Acompañamiento a controles, consultas y exámenes.",
    TRAMITE: "Ayuda presencial con gestiones y documentos.",
    COMPRAS: "Compras esenciales y abastecimiento del hogar.",
    TECNOLOGIA: "Configuración de celular, videollamadas y aplicaciones.",
    RECREACION: "Paseos seguros y actividades de bienestar.",
  }[id]!,
}));

function publicUser(user: typeof users.$inferSelect) {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    phone: user.phone,
    dni: user.dni,
    role: user.role,
  };
}

function authResponse(user: typeof users.$inferSelect) {
  return { token: createToken({ id: user.id, role: user.role }), user: publicUser(user) };
}

async function requestRows(where?: ReturnType<typeof eq>) {
  const rows = await db
    .select({
      id: serviceRequests.id,
      serviceType: serviceRequests.serviceType,
      status: serviceRequests.status,
      scheduledAt: serviceRequests.scheduledAt,
      durationHours: serviceRequests.durationHours,
      pickupAddress: serviceRequests.pickupAddress,
      destinationAddress: serviceRequests.destinationAddress,
      notes: serviceRequests.notes,
      createdAt: serviceRequests.createdAt,
      clientName: users.fullName,
      seniorName: seniors.fullName,
      workerId: workers.id,
      workerName: sql<string | null>`${workers.id}::text`,
      rating: reviews.rating,
      reviewComment: reviews.comment,
    })
    .from(serviceRequests)
    .innerJoin(users, eq(serviceRequests.clientId, users.id))
    .innerJoin(seniors, eq(serviceRequests.seniorId, seniors.id))
    .leftJoin(workers, eq(serviceRequests.workerId, workers.id))
    .leftJoin(reviews, eq(serviceRequests.id, reviews.requestId))
    .where(where)
    .orderBy(desc(serviceRequests.scheduledAt));

  const workerUserIds = rows.filter((row) => row.workerId).map((row) => row.workerId!);
  const workerNames = workerUserIds.length
    ? await db.select({ id: workers.id, name: users.fullName }).from(workers).innerJoin(users, eq(workers.userId, users.id)).where(inArray(workers.id, workerUserIds))
    : [];
  const names = new Map(workerNames.map((row) => [row.id, row.name]));

  return rows.map((row) => ({
    ...row,
    serviceLabel: SERVICE_LABELS[row.serviceType] ?? row.serviceType,
    durationHours: Number(row.durationHours),
    workerName: row.workerId ? names.get(row.workerId) ?? null : null,
    rating: row.rating ?? null,
    createdAt: row.createdAt ?? new Date(),
  }));
}

router.post("/auth/login", async (req, res) => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Revisa el correo y la contraseña." });
    return;
  }
  const email = parsed.data.email.trim().toLowerCase();
  const user = await db.query.users.findFirst({ where: eq(users.email, email) });
  if (!user || !(await bcrypt.compare(parsed.data.password, user.password))) {
    res.status(401).json({ error: "Correo o contraseña incorrectos." });
    return;
  }
  res.json(authResponse(user));
});

router.post("/auth/register", async (req, res) => {
  const parsed = RegisterClientBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Completa los datos del cliente correctamente." });
    return;
  }
  const email = parsed.data.email.trim().toLowerCase();
  const exists = await db.query.users.findFirst({ where: eq(users.email, email) });
  if (exists) {
    res.status(409).json({ error: "Ese correo ya está registrado." });
    return;
  }
  const [user] = await db.insert(users).values({
    email,
    password: await bcrypt.hash(parsed.data.password, 10),
    role: "CLIENTE_DECISOR",
    fullName: parsed.data.fullName.trim(),
    phone: parsed.data.phone?.trim() || null,
    dni: parsed.data.dni || null,
  }).returning();
  res.status(201).json(authResponse(user));
});

router.get("/auth/me", requireAuth, async (req, res) => {
  const user = await db.query.users.findFirst({ where: eq(users.id, req.authUser!.id) });
  if (!user) {
    res.status(401).json({ error: "Usuario no encontrado." });
    return;
  }
  res.json(GetCurrentUserResponse.parse(publicUser(user)));
});

router.get("/dashboard", requireAuth, async (req, res) => {
  const user = req.authUser!;
  const visible = user.role === "CLIENTE_DECISOR"
    ? eq(serviceRequests.clientId, user.id)
    : user.role === "PERSONAL_ACOMPANANTE"
      ? eq(workers.userId, user.id)
      : undefined;
  const rows = await requestRows(visible);
  const pending = rows.filter((row) => ["SOLICITADO", "ASIGNADO"].includes(row.status)).length;
  const active = rows.filter((row) => ["ASIGNADO", "EN_CURSO"].includes(row.status)).length;
  const ratings = rows.map((row) => row.rating).filter((rating): rating is number => rating !== null);
  const data = {
    role: user.role,
    stats: {
      totalRequests: rows.length,
      pendingRequests: pending,
      activeServices: active,
      averageRating: ratings.length ? ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length : 0,
    },
    recentRequests: rows.slice(0, 5),
  };
  res.json(GetDashboardResponse.parse(data));
});

router.get("/seniors", requireAuth, requireRole("CLIENTE_DECISOR"), async (req, res) => {
  const result = await db.select({
    id: seniors.id,
    fullName: seniors.fullName,
    age: seniors.age,
    medicalNotes: seniors.medicalNotes,
    emergencyContact: seniors.emergencyContact,
  }).from(seniors).where(eq(seniors.clientId, req.authUser!.id)).orderBy(asc(seniors.fullName));
  res.json(ListSeniorsResponse.parse(result));
});

router.post("/seniors", requireAuth, requireRole("CLIENTE_DECISOR"), async (req, res) => {
  const parsed = CreateSeniorBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Revisa los datos del adulto mayor." });
    return;
  }
  const [senior] = await db.insert(seniors).values({
    clientId: req.authUser!.id,
    fullName: parsed.data.fullName.trim(),
    age: parsed.data.age,
    medicalNotes: parsed.data.medicalNotes?.trim() || null,
    emergencyContact: parsed.data.emergencyContact?.trim() || null,
  }).returning();
  res.status(201).json(senior);
});

router.get("/workers", requireAuth, requireRole("ADMINISTRADOR"), async (_req, res) => {
  const result = await db.select({
    id: workers.id,
    fullName: users.fullName,
    email: users.email,
    phone: users.phone,
    dni: users.dni,
    status: workers.status,
    skills: workers.skills,
    backgroundChecked: workers.backgroundChecked,
    rating: sql<number>`coalesce(avg(${reviews.rating}), 0)`,
    completedServices: sql<number>`count(distinct case when ${serviceRequests.status} = 'FINALIZADO' then ${serviceRequests.id} end)`,
  })
    .from(workers)
    .innerJoin(users, eq(workers.userId, users.id))
    .leftJoin(serviceRequests, eq(workers.id, serviceRequests.workerId))
    .leftJoin(reviews, eq(serviceRequests.id, reviews.requestId))
    .groupBy(workers.id, users.id)
    .orderBy(asc(users.fullName));
  res.json(ListWorkersResponse.parse(result.map((row) => ({
    ...row,
    rating: Number(row.rating),
    completedServices: Number(row.completedServices),
  }))));
});

router.post("/workers", requireAuth, requireRole("ADMINISTRADOR"), async (req, res) => {
  const parsed = CreateWorkerBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Revisa los datos del trabajador." });
    return;
  }
  const email = parsed.data.email.trim().toLowerCase();
  const exists = await db.query.users.findFirst({ where: eq(users.email, email) });
  if (exists) {
    res.status(409).json({ error: "Ese correo ya está registrado." });
    return;
  }
  const [user] = await db.insert(users).values({
    email,
    password: await bcrypt.hash(parsed.data.password, 10),
    role: "PERSONAL_ACOMPANANTE",
    fullName: parsed.data.fullName.trim(),
    phone: parsed.data.phone.trim(),
    dni: parsed.data.dni,
  }).returning();
  await db.insert(workers).values({
    userId: user.id,
    skills: parsed.data.skills?.trim() || null,
    backgroundChecked: parsed.data.backgroundChecked,
  });
  const [worker] = await db.select({
    id: workers.id,
    fullName: users.fullName,
    email: users.email,
    phone: users.phone,
    dni: users.dni,
    status: workers.status,
    skills: workers.skills,
    backgroundChecked: workers.backgroundChecked,
    rating: sql<number>`0`,
    completedServices: sql<number>`0`,
  }).from(workers).innerJoin(users, eq(workers.userId, users.id)).where(eq(workers.userId, user.id));
  res.status(201).json(worker);
});

router.get("/services", requireAuth, (_req, res) => {
  res.json(ListServicesResponse.parse(SERVICE_OPTIONS));
});

router.get("/requests", requireAuth, async (req, res) => {
  const user = req.authUser!;
  const where = user.role === "CLIENTE_DECISOR"
    ? eq(serviceRequests.clientId, user.id)
    : user.role === "PERSONAL_ACOMPANANTE"
      ? eq(workers.userId, user.id)
      : undefined;
  res.json(ListRequestsResponse.parse(await requestRows(where)));
});

router.post("/requests", requireAuth, requireRole("CLIENTE_DECISOR"), async (req, res) => {
  const parsed = CreateRequestBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Completa los datos de la solicitud." });
    return;
  }
  const senior = await db.query.seniors.findFirst({
    where: and(eq(seniors.id, parsed.data.seniorId), eq(seniors.clientId, req.authUser!.id)),
  });
  if (!senior) {
    res.status(404).json({ error: "El adulto mayor no pertenece a tu cuenta." });
    return;
  }
  const [created] = await db.insert(serviceRequests).values({
    clientId: req.authUser!.id,
    seniorId: parsed.data.seniorId,
    serviceType: parsed.data.serviceType,
    scheduledAt: parsed.data.scheduledAt,
    durationHours: parsed.data.durationHours.toFixed(1),
    pickupAddress: parsed.data.pickupAddress.trim(),
    destinationAddress: parsed.data.destinationAddress?.trim() || null,
    notes: parsed.data.notes?.trim() || null,
  }).returning();
  const [row] = await requestRows(eq(serviceRequests.id, created.id));
  res.status(201).json(row);
});

router.patch("/requests/:requestId/status", requireAuth, async (req, res) => {
  const params = UpdateRequestStatusParams.safeParse(req.params);
  const body = UpdateRequestStatusBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Estado no válido." });
    return;
  }
  if (req.authUser!.role !== "ADMINISTRADOR" && req.authUser!.role !== "PERSONAL_ACOMPANANTE") {
    res.status(403).json({ error: "Solo administración o personal puede actualizar estados." });
    return;
  }
  const [updated] = await db.update(serviceRequests).set({
    status: body.data.status,
    updatedAt: new Date(),
  }).where(eq(serviceRequests.id, params.data.requestId)).returning();
  if (!updated) {
    res.status(404).json({ error: "Solicitud no encontrada." });
    return;
  }
  const [row] = await requestRows(eq(serviceRequests.id, updated.id));
  res.json(row);
});

router.patch("/requests/:requestId/assign", requireAuth, requireRole("ADMINISTRADOR"), async (req, res) => {
  const params = AssignRequestParams.safeParse(req.params);
  const body = AssignRequestBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Trabajador no válido." });
    return;
  }
  const worker = await db.query.workers.findFirst({ where: eq(workers.id, body.data.workerId) });
  if (!worker) {
    res.status(404).json({ error: "Trabajador no encontrado." });
    return;
  }
  const [updated] = await db.update(serviceRequests).set({
    workerId: body.data.workerId,
    status: "ASIGNADO",
    updatedAt: new Date(),
  }).where(eq(serviceRequests.id, params.data.requestId)).returning();
  if (!updated) {
    res.status(404).json({ error: "Solicitud no encontrada." });
    return;
  }
  res.json((await requestRows(eq(serviceRequests.id, updated.id)))[0]);
});

router.post("/reviews", requireAuth, requireRole("CLIENTE_DECISOR"), async (req, res) => {
  const parsed = CreateReviewBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "La calificación debe estar entre 1 y 5." });
    return;
  }
  const request = await db.query.serviceRequests.findFirst({
    where: and(eq(serviceRequests.id, parsed.data.requestId), eq(serviceRequests.clientId, req.authUser!.id)),
  });
  if (!request || request.status !== "FINALIZADO") {
    res.status(400).json({ error: "Solo puedes calificar servicios finalizados." });
    return;
  }
  const already = await db.query.reviews.findFirst({ where: eq(reviews.requestId, request.id) });
  if (already) {
    res.status(409).json({ error: "Este servicio ya tiene una reseña." });
    return;
  }
  const [review] = await db.insert(reviews).values({
    requestId: request.id,
    rating: parsed.data.rating,
    comment: parsed.data.comment?.trim() || null,
  }).returning();
  res.status(201).json(review);
});

router.get("/backups/requests.xlsx", requireAuth, requireRole("ADMINISTRADOR"), async (_req, res) => {
  const rows = await requestRows();
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Solicitudes");
  sheet.columns = [
    { header: "ID", key: "id", width: 38 },
    { header: "Servicio", key: "serviceLabel", width: 24 },
    { header: "Estado", key: "status", width: 16 },
    { header: "Fecha programada", key: "scheduledAt", width: 24 },
    { header: "Cliente", key: "clientName", width: 24 },
    { header: "Adulto mayor", key: "seniorName", width: 24 },
    { header: "Trabajador", key: "workerName", width: 24 },
    { header: "Dirección", key: "pickupAddress", width: 35 },
    { header: "Calificación", key: "rating", width: 14 },
    { header: "Comentario", key: "reviewComment", width: 35 },
  ];
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F766E" } };
  rows.forEach((row) => sheet.addRow({
    ...row,
    scheduledAt: new Date(row.scheduledAt).toLocaleString("es-PE"),
  }));
  const buffer = await workbook.xlsx.writeBuffer();
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", 'attachment; filename="contigo-solicitudes.xlsx"');
  res.send(Buffer.from(buffer));
});

export default router;