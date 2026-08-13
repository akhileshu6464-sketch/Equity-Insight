import { Router, type IRouter } from "express";
import aiRouter from "./ai";
import companiesRouter from "./companies";
import healthRouter from "./health";

const router: IRouter = Router();

router.use(healthRouter);
router.use(companiesRouter);
router.use(aiRouter);

export default router;
