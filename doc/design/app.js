// DG Signals design — shared behaviour for the static HTML pages.
// In the real app these become React components; this file only makes the
// mockup clickable.

const ICONS = {
  home: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  alerts: '<path d="M6 9a6 6 0 0 1 12 0c0 6 3 8 3 8H3s3-2 3-8"/><path d="M10 21h4"/>',
  chart: '<path d="M4 4v16h16"/><path d="M8 14v-3M12 16V8M16 12V6"/>',
  watchlist: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  journal: '<path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"/><path d="M9 9h6M9 13h6"/>',
};

const TABS = [
  ["home", "Home", "overview.html"],
  ["alerts", "Alerts", "alerts.html"],
  ["chart", "Chart", "chart.html"],
  ["watchlist", "Watchlist", "watchlist.html"],
  ["journal", "Journal", "journal.html"],
];

function svg(path) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
}

// Bottom tab bar: <nav data-tabbar data-active="alerts"></nav>
document.querySelectorAll("[data-tabbar]").forEach((nav) => {
  const active = nav.dataset.active;
  nav.className = "tabbar";
  nav.setAttribute("aria-label", "Main");
  nav.innerHTML =
    '<div class="tabbar-inner">' +
    TABS.map(([key, label, href]) =>
      `<a class="tab" href="${href}"${key === active ? ' aria-current="page"' : ""}>${svg(ICONS[key])}<span>${label}</span></a>`
    ).join("") +
    "</div>";
});

// Switches
document.querySelectorAll(".switch").forEach((btn) => {
  btn.addEventListener("click", () => {
    const on = btn.getAttribute("aria-checked") === "true";
    btn.setAttribute("aria-checked", String(!on));
    btn.dispatchEvent(new CustomEvent("toggle", { bubbles: true, detail: !on }));
  });
});

// Single-select groups (chips, segmented controls): <div data-select>
document.querySelectorAll("[data-select]").forEach((group) => {
  group.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => {
      group.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", "false"));
      btn.setAttribute("aria-pressed", "true");
      group.dispatchEvent(new CustomEvent("select", { detail: btn.dataset.value || btn.textContent.trim() }));
    });
  });
});

function toast(message) {
  let el = document.querySelector(".toast");
  if (!el) {
    el = document.createElement("div");
    el.className = "toast";
    el.setAttribute("role", "status");
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove("show"), 3200);
}
