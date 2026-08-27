import { Router, type IRouter } from "express";
import healthRouter from "./health";
import aiRouter from "./ai";
import companiesRouter from "./companies";
import intelligenceRouter from "./intelligence";

const router: IRouter = Router();

router.use(healthRouter);
router.use(aiRouter);
router.use(companiesRouter);
router.use(intelligenceRouter);

export default router;
