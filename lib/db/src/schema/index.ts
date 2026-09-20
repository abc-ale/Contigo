import {
  boolean,
  decimal,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const userRole = pgEnum("user_role", [
  "CLIENTE_DECISOR",
  "PERSONAL_ACOMPANANTE",
  "ADMINISTRADOR",
]);

export const workerStatus = pgEnum("worker_status", [
  "DISPONIBLE",
  "EN_SERVICIO",
  "INACTIVO",
]);

export const requestStatus = pgEnum("request_status", [
  "SOLICITADO",
  "ASIGNADO",
  "EN_CURSO",
  "FINALIZADO",
  "CANCELADO",
]);

export const serviceType = pgEnum("service_type", [
  "CITA_MEDICA",
  "TRAMITE",
  "COMPRAS",
  "TECNOLOGIA",
  "RECREACION",
]);

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: varchar("email", { length: 160 }).notNull().unique(),
  password: varchar("password", { length: 100 }).notNull(),
  role: userRole("role").notNull().default("CLIENTE_DECISOR"),
  fullName: varchar("full_name", { length: 160 }).notNull(),
  phone: varchar("phone", { length: 30 }),
  dni: varchar("dni", { length: 8 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const seniors = pgTable("senior_persons", {
  id: uuid("id").defaultRandom().primaryKey(),
  clientId: uuid("client_id").notNull().references(() => users.id),
  fullName: varchar("full_name", { length: 160 }).notNull(),
  age: integer("age").notNull(),
  medicalNotes: text("medical_notes"),
  emergencyContact: varchar("emergency_contact", { length: 200 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const workers = pgTable("workers", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().unique().references(() => users.id),
  skills: text("skills"),
  backgroundChecked: boolean("background_checked").notNull().default(false),
  status: workerStatus("status").notNull().default("DISPONIBLE"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const serviceRequests = pgTable("service_requests", {
  id: uuid("id").defaultRandom().primaryKey(),
  clientId: uuid("client_id").notNull().references(() => users.id),
  seniorId: uuid("senior_id").notNull().references(() => seniors.id),
  workerId: uuid("worker_id").references(() => workers.id),
  serviceType: serviceType("service_type").notNull(),
  status: requestStatus("status").notNull().default("SOLICITADO"),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
  durationHours: numeric("duration_hours", { precision: 4, scale: 1 }).notNull(),
  pickupAddress: varchar("pickup_address", { length: 300 }).notNull(),
  destinationAddress: varchar("destination_address", { length: 300 }),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const reviews = pgTable("reviews", {
  id: uuid("id").defaultRandom().primaryKey(),
  requestId: uuid("request_id").notNull().unique().references(() => serviceRequests.id),
  rating: integer("rating").notNull(),
  comment: text("comment"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type User = typeof users.$inferSelect;
export type Senior = typeof seniors.$inferSelect;
export type Worker = typeof workers.$inferSelect;
export type ServiceRequest = typeof serviceRequests.$inferSelect;
export type Review = typeof reviews.$inferSelect;