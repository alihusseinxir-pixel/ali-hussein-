import { z } from "zod";

const opt = (max = 5000) => z.string().trim().max(max).optional().transform((v) => (v ? v : null));

export const handoverSchema = z.object({
  toUserId: z.string().min(1, "اختر من يستلم المهمة"),
  instructions: opt(),
  requiredOutput: opt(1000),
  deliverables: opt(),
  comments: opt(),
  deadline: z.string().trim().optional().transform((v) => (v ? v : null)),
});
export type HandoverInput = z.infer<typeof handoverSchema>;

export const revisionSchema = z.object({
  notes: z.string().trim().min(5, "صف التعديلات المطلوبة").max(5000),
});
