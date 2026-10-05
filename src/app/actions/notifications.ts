"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { markAllRead, setEmailPreference } from "@/lib/notifications";

export async function markAllReadAction() {
  await markAllRead(await requireUser());
  revalidatePath("/notifications");
}

export async function setEmailPreferenceAction(fd: FormData) {
  await setEmailPreference(await requireUser(), fd.get("enabled") === "on");
  revalidatePath("/notifications");
}
