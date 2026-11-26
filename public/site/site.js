// التجربة الحية + نموذج طلب التجربة المجانية
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const MODES = {
  restaurant: {
    title: "مطعم بيت الكبة (مثال)",
    hello: "هلا بيك بمطعم بيت الكبة 🌹 شلون أگدر أساعدك؟",
    suggest: ["شكد سعر التكة؟", "توصلون للجادرية؟", "احنا 4 أشخاص، شنو تنصحني؟", "عدكم شي نباتي؟"],
  },
  sales: {
    title: "رد — فريق المبيعات",
    hello: "هلا بيك 🌹 أنا «رد»، نفس النظام اللي تشوفه. اسألني أي شي عن شلون أشتغل لمحلك.",
    suggest: ["شنو يفرق عن الرد التلقائي العادي؟", "شكد السعر؟", "عندي عيادة، يناسبني؟", "غالي شوية"],
  },
};

let mode = "restaurant";
const sessions = {};
const logs = { restaurant: [], sales: [] };
const sid = () => (sessions[mode] ||= Math.random().toString(36).slice(2, 12) + Date.now().toString(36));
let busy = false;

function render(typing = false) {
  const log = logs[mode];
  const all = [{ who: "out", text: MODES[mode].hello }, ...log];
  $("#chat").innerHTML =
    all
      .map((m) => {
        const chips = m.buttons?.length
          ? `<div class="chips">${m.buttons.map((b) => `<button type="button" data-q="${esc(b)}">${esc(b)}</button>`).join("")}</div>`
          : "";
        return `<div class="bubble ${m.who}">${esc(m.text)}${chips}</div>`;
      })
      .join("") + (typing ? '<div class="typing">جاي يكتب…</div>' : "");
  $("#chat").scrollTop = $("#chat").scrollHeight;
  $("#chat").querySelectorAll("[data-q]").forEach((b) => (b.onclick = () => send(b.dataset.q)));
  $("#suggest").innerHTML = log.length ? "" : MODES[mode].suggest.map((q) => `<button type="button">${esc(q)}</button>`).join("");
  $("#suggest").querySelectorAll("button").forEach((b) => (b.onclick = () => send(b.textContent)));
  $("#demoTitle").textContent = MODES[mode].title;
}

async function send(text) {
  text = String(text || "").trim();
  if (!text || busy) return;
  busy = true;
  const m = mode;
  logs[m].push({ who: "in", text });
  render(true);
  try {
    const res = await fetch("/demo/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: sid(), text, mode: m }),
    });
    const data = await res.json().catch(() => ({}));
    logs[m].push({ who: "out", text: res.ok ? data.reply || "…" : data.error || "صار خطأ، جرب مرة ثانية", buttons: data.buttons });
  } catch {
    logs[m].push({ who: "out", text: "الاتصال انقطع، جرب مرة ثانية" });
  }
  busy = false;
  if (m === mode) render();
}

$("#chatForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const v = $("#chatInput").value;
  $("#chatInput").value = "";
  send(v);
});
document.querySelectorAll(".tab").forEach((t) =>
  t.addEventListener("click", () => {
    mode = t.dataset.mode;
    document.querySelectorAll(".tab").forEach((x) => x.classList.toggle("on", x === t));
    render();
  })
);
render();

$("#leadForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target;
  const btn = f.querySelector("button[type=submit]");
  const msg = $("#leadMsg");
  btn.disabled = true;
  msg.className = "lead-msg";
  msg.textContent = "جاي يرسل…";
  try {
    const res = await fetch("/demo/lead", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.fromEntries(new FormData(f))),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "صار خطأ");
    msg.className = "lead-msg ok";
    msg.textContent = "وصلنا طلبك 🌹 راح نتواصل وياك قريباً على الواتساب.";
    f.reset();
  } catch (err) {
    msg.className = "lead-msg err";
    msg.textContent = err.message;
  }
  btn.disabled = false;
});
