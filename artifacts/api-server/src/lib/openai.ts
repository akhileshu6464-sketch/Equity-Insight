import OpenAI from "openai";
import { logger } from "./logger";

const apiKey = process.env["OPENAI_API_KEY"];

if (!apiKey) {
  logger.warn("OPENAI_API_KEY is not set — OpenAI features will not work");
}

export const openai = new OpenAI({ apiKey });
