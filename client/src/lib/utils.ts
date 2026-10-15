import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

/** A key for a row added to a form's list: one above the highest in use. */
export const nextRowId = (rows: { id: number }[]) =>
  Math.max(-1, ...rows.map((row) => row.id)) + 1;
