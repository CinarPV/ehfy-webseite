// Monatskalender für Anmeldung und Verwaltung.
// const cal = EHFYCalendar(element, { marks, selected, onPick, onMonth, isPickable, highlightWeekdays });
//   marks:     { "2026-11-08": { cls: "has-free", label: "S" } }  – Markierungen pro Tag
//   selected:  Set von Tagen ("YYYY-MM-DD"), die ausgewählt dargestellt werden
//   onPick:    Funktion(key) beim Antippen eines Tages
//   isPickable: Funktion(key, date) → true/false (Standard: nur Tage mit Markierung)
(function () {
  const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
  const DAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
  const pad = n => String(n).padStart(2, "0");

  window.EHFYKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  window.EHFYCalendar = function (el, opts = {}) {
    const state = {
      month: opts.month ? new Date(opts.month.getFullYear(), opts.month.getMonth(), 1) : firstOfMonth(new Date()),
      marks: opts.marks || {},
      selected: opts.selected || new Set(),
      highlight: new Set(opts.highlightWeekdays || [])
    };
    const todayKey = EHFYKey(new Date());

    function firstOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }

    function render() {
      const y = state.month.getFullYear(), m = state.month.getMonth();
      const offset = (new Date(y, m, 1).getDay() + 6) % 7; // Montag zuerst
      const days = new Date(y, m + 1, 0).getDate();
      let cells = "";
      for (let i = 0; i < offset; i++) cells += '<span class="cal-empty"></span>';
      for (let d = 1; d <= days; d++) {
        const date = new Date(y, m, d);
        const key = EHFYKey(date);
        const mark = state.marks[key];
        const pickable = opts.isPickable ? opts.isPickable(key, date) : Boolean(mark);
        const cls = ["cal-day",
          mark ? mark.cls : "",
          state.selected.has(key) ? "is-selected" : "",
          key === todayKey ? "is-today" : "",
          key < todayKey ? "is-past" : "",
          state.highlight.has(date.getDay()) ? "is-hl" : ""
        ].filter(Boolean).join(" ");
        cells += `<button type="button" class="${cls}" data-key="${key}" ${pickable ? "" : "disabled"}
          aria-label="${d}. ${MONTHS[m]}${mark && mark.title ? ": " + mark.title : ""}" aria-pressed="${state.selected.has(key)}">
          <span class="cal-num">${d}</span>${mark && mark.label ? `<span class="cal-dot">${mark.label}</span>` : ""}</button>`;
      }
      el.innerHTML = `
        <div class="cal">
          <div class="cal-head">
            <button type="button" class="cal-nav" data-nav="-1" aria-label="Vorheriger Monat">‹</button>
            <strong>${MONTHS[m]} ${y}</strong>
            <button type="button" class="cal-nav" data-nav="1" aria-label="Nächster Monat">›</button>
          </div>
          <div class="cal-grid cal-wd">${DAYS.map((d, i) => `<span class="${i >= 5 ? "we" : ""}">${d}</span>`).join("")}</div>
          <div class="cal-grid">${cells}</div>
        </div>`;
    }

    el.onclick = ev => {
      const nav = ev.target.closest("[data-nav]");
      if (nav) {
        state.month = new Date(state.month.getFullYear(), state.month.getMonth() + Number(nav.dataset.nav), 1);
        render();
        if (opts.onMonth) opts.onMonth(state.month);
        return;
      }
      const day = ev.target.closest(".cal-day");
      if (day && !day.disabled && opts.onPick) opts.onPick(day.dataset.key);
    };

    render();
    return {
      setMarks(m) { state.marks = m; render(); },
      setSelected(s) { state.selected = s; render(); },
      setMonth(d) { state.month = firstOfMonth(d); render(); },
      getMonth() { return state.month; },
      render
    };
  };
})();
