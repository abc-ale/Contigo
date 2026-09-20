import { Router, type IRouter } from "express";
import healthRouter from "./health";
import contigoRouter from "./contigo";

const router: IRouter = Router();

router.use(healthRouter);
router.use(contigoRouter);

export default router;
