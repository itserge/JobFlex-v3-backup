/* JobFlex website estimator — the button a contractor pastes on their own site (2026-10-27).
   <script src="https://www.jobflex.app/embed/estimator.js" data-shop="ridgeline-roofing" data-trade="roof" async></script>
   Draws a button where the tag sits; a click opens the shop's JobFlex estimator in an overlay. Options on the tag:
   data-label="Get my roof price"  data-color="#1854a0"  data-inline="1" (an inline frame instead of a button + overlay).
   Nothing else on the host page is read or changed. */
(function () {
  var me = document.currentScript;
  if (!me) { var all = document.querySelectorAll('script[data-shop][data-trade]'); me = all[all.length - 1]; }
  if (!me) return;
  var shop = me.getAttribute("data-shop"), trade = me.getAttribute("data-trade") || "roof";
  if (!shop) return;
  var origin = (function () { try { return new URL(me.src).origin; } catch { return "https://www.jobflex.app"; } })();
  var host = location.hostname;
  var url = origin + "/estimate/" + encodeURIComponent(shop) + "/" + encodeURIComponent(trade) + "?embed=1&host=" + encodeURIComponent(host);
  // The shop's brand colour and the trade's words ride on the tag (Settings → Website estimators writes both); a colour
  // that is not a plain hex falls back to the blueprint blue, and the text is white or ink, whichever reads on it.
  var color = (me.getAttribute("data-color") || "").trim();
  if (!/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(color)) color = "#1854a0";
  var ink = (function () {
    var h = color.slice(1); if (h.length === 3) h = h.replace(/./g, function (x) { return x + x; });
    var l = [0, 2, 4].map(function (i) { var v = parseInt(h.slice(i, i + 2), 16) / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2] > 0.4 ? "#0b0d12" : "#fff";
  })();
  var labels = { roof: "Get my roof price", hvac: "Price my new system", fence: "Price my fence", deck: "Design my deck", smart: "Price my project" };
  var label = (me.getAttribute("data-label") || "").trim().slice(0, 60) || labels[trade] || "Get my price";

  function frame(parent, height) {
    var f = document.createElement("iframe");
    f.src = url; f.title = "JobFlex estimator"; f.setAttribute("loading", "lazy"); f.setAttribute("allow", "geolocation");
    f.style.cssText = "width:100%;height:" + height + ";border:0;display:block;background:#fff";
    parent.appendChild(f);
    return f;
  }

  if (me.getAttribute("data-inline") === "1") {
    var box = document.createElement("div");
    box.style.cssText = "width:100%;min-height:720px;border-radius:12px;overflow:hidden;box-shadow:0 0 0 1px rgba(0,0,0,.08)";
    me.parentNode.insertBefore(box, me);
    frame(box, "720px");
    return;
  }

  var btn = document.createElement("button");
  btn.type = "button"; btn.textContent = label;
  btn.setAttribute("data-jobflex-estimator", trade);
  btn.style.cssText = "display:inline-flex;align-items:center;gap:10px;padding:14px 22px;border:0;border-radius:10px;background:" + color +
    ";color:" + ink + ";font:600 16px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;cursor:pointer;box-shadow:0 8px 20px -8px rgba(0,0,0,.35)";
  me.parentNode.insertBefore(btn, me);

  var overlay = null;
  function close() { if (!overlay) return; overlay.remove(); overlay = null; document.body.style.overflow = ""; }
  function open() {
    if (overlay) return;
    overlay = document.createElement("div");
    overlay.setAttribute("role", "dialog"); overlay.setAttribute("aria-label", label);
    overlay.style.cssText = "position:fixed;inset:0;z-index:2147483000;background:rgba(10,12,18,.62);display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box";
    var panel = document.createElement("div");
    panel.style.cssText = "position:relative;width:min(960px,100%);height:min(860px,100%);background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 40px 100px -20px rgba(0,0,0,.6)";
    var x = document.createElement("button");
    x.type = "button"; x.setAttribute("aria-label", "Close"); x.innerHTML = "&#x2715;";
    x.style.cssText = "position:absolute;top:10px;right:10px;z-index:2;width:36px;height:36px;border:0;border-radius:50%;background:rgba(255,255,255,.92);color:#0b0d12;font-size:16px;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.2)";
    x.addEventListener("click", close);
    panel.appendChild(x);
    frame(panel, "100%");
    overlay.appendChild(panel);
    overlay.addEventListener("click", function (e) { if (e.target === overlay) close(); });
    document.body.appendChild(overlay);
    document.body.style.overflow = "hidden";
  }
  btn.addEventListener("click", open);
  window.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });
  window.addEventListener("message", function (e) {
    if (e.origin !== origin || !e.data || e.data.jobflex !== "estimator") return;
    if (e.data.event === "close") close();
    if (e.data.event === "lead") { try { window.dispatchEvent(new CustomEvent("jobflex:lead", { detail: { trade: trade } })); } catch { /* old browsers */ } }
  });
})();
