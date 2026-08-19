import { Router, type IRouter } from "express";
import aiRouter from "./ai";
import companiesRouter from "./companies";
import healthRouter from "./health";
import { ingestionRouter } from "./ingestion.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(companiesRouter);
router.use(aiRouter);
router.use("/ingestion", ingestionRouter);

export default router;
