import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";

export type AuthUser = {
  id: string;
  role: "CLIENTE_DECISOR" | "PERSONAL_ACOMPANANTE" | "ADMINISTRADOR";
};

declare global {
  namespace Express {
    interface Request {
      authUser?: AuthUser;
    }
  }
}

const secret = () => process.env.SESSION_SECRET ?? "contigo-local-development-secret-change-me";

export function createToken(user: AuthUser): string {
  return jwt.sign(user, secret(), { expiresIn: "8h" });
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Debes iniciar sesión." });
    return;
  }

  try {
    req.authUser = jwt.verify(header.slice(7), secret()) as AuthUser;
    next();
  } catch {
    res.status(401).json({ error: "La sesión expiró. Vuelve a iniciar sesión." });
  }
}

export function requireRole(...roles: AuthUser["role"][]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.authUser || !roles.includes(req.authUser.role)) {
      res.status(403).json({ error: "No tienes permisos para realizar esta acción." });
      return;
    }
    next();
  };
}