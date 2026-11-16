import { randomBytes } from "node:crypto";

export const rootKey = randomBytes(24).toString("base64url");
export const demoKey = randomBytes(24).toString("base64url");
