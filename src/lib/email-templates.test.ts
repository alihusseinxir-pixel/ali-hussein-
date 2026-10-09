import { describe, expect, it } from "vitest";
import { digestEmail, inviteEmail, newNotificationsPhrase, passwordResetEmail } from "./email-templates";

describe("email templates (Arabic)", () => {
  it("invitation names the organization, inviter and Arabic role, with the link alone on its own line", () => {
    const m = inviteEmail({ name: "سارة", inviter: "علي", organization: "وكالة بصمة", role: "VIDEOGRAPHER", link: "https://app/invite/tok" });
    expect(m.subject).toBe("دعوة للانضمام إلى وكالة بصمة على BASMA MARKETING");
    expect(m.text).toContain("مرحباً سارة،");
    expect(m.text).toContain("دعاك علي للانضمام إلى وكالة بصمة بدور مصوّر فيديو");
    expect(m.text).toContain("7 أيام");
    expect(m.text.split("\n")).toContain("https://app/invite/tok");
  });
  it("password reset keeps the token extractable and warns it is single use", () => {
    const m = passwordResetEmail({ name: "سارة", link: "http://app/reset-password/abc_DEF-123" });
    expect(/reset-password\/([\w-]+)/.exec(m.text)![1]).toBe("abc_DEF-123");
    expect(m.text).toContain("ساعة واحدة");
    expect(m.text).toContain("لم تتغير كلمة مرورك");
    expect(m.subject).toContain("استعادة كلمة المرور");
  });
  it("uses correct Arabic count agreement", () => {
    expect([1, 2, 3, 10, 11, 25].map(newNotificationsPhrase)).toEqual(["إشعار جديد", "إشعاران جديدان", "3 إشعارات جديدة", "10 إشعارات جديدة", "11 إشعاراً جديداً", "25 إشعاراً جديداً"]);
  });
  it("digest: one item uses its message as the subject; several list every item with its link", () => {
    const one = digestEmail({ name: "علي", appUrl: "http://x", items: [{ message: "أُسندت إليك المهمة T-1", url: "http://x/tasks/1" }] });
    expect(one.subject).toBe("أُسندت إليك المهمة T-1");
    const many = digestEmail({ name: "علي", appUrl: "http://x", items: [{ message: "A", url: null }, { message: "B", url: "http://x/tasks/2" }, { message: "C", url: null }] });
    expect(many.subject).toBe("3 إشعارات جديدة في BASMA MARKETING");
    expect(many.text).toContain("• A"); expect(many.text).toContain("• B\nhttp://x/tasks/2");
    expect(many.text).toContain("http://x/notifications");
    expect(many.text).toContain("يمكنك إيقاف هذه الرسائل");
  });
  it("truncates a very long single-notification subject", () => {
    expect(digestEmail({ name: "x", appUrl: "u", items: [{ message: "ا".repeat(300), url: null }] }).subject).toHaveLength(120);
  });
});
