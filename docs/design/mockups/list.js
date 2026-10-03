// Standalone local prototype. No network, storage replica or product shortcuts.
const drawer = document.querySelector("dialog");
let activeRow = null;
let opener = null;
let draggedRow = null;
function closeNav(sidebar) {
  sidebar.classList.remove("is-open");
  const panel = sidebar.closest(".shell").querySelector(".panel");
  panel.inert = false;
  const btn = panel.querySelector('[data-action="nav"]');
  btn.setAttribute("aria-expanded", "false");
  btn.focus();
}
const escaped = (value) => {
  const node = document.createElement("span");
  node.textContent = value;
  return node.innerHTML;
};
function closeMenus(except) {
  document.querySelectorAll(".menu").forEach((menu) => {
    if (menu === except) return;
    menu.hidden = true;
    menu.parentElement
      .querySelector('[data-action="menu"]')
      .setAttribute("aria-expanded", "false");
  });
}
function openTask(row, trigger, parent = false) {
  activeRow = parent ? null : row;
  opener = trigger;
  const theme = row.closest(".theme");
  drawer.classList.toggle("dark", theme.classList.contains("dark"));
  drawer.querySelector('[name="title"]').value = parent
    ? "Clean kitchen"
    : row.querySelector(".task-title").textContent;
  drawer.querySelector('[name="notes"]').value = row.dataset.notes || "";
  const url = new URL(location.href);
  url.searchParams.set("task", parent ? "clean-kitchen" : row.dataset.taskId);
  history.replaceState(null, "", url);
  closeMenus();
  drawer.showModal();
  drawer.querySelector('[name="title"]').focus();
}
function mark(row, kind) {
  const recurring = row.dataset.recurring === "true";
  const title = row.querySelector(".task-title").textContent;
  const list = row.parentElement;
  const next = row.nextElementSibling;
  const ru = row.closest(".phone") !== null;
  const occurrence = row.querySelector(".occurrence time");
  const oldDate = occurrence?.textContent;
  if (!recurring) row.remove();
  else if (occurrence) {
    occurrence.textContent = "2026-10-03";
    occurrence.dateTime = "2026-10-03";
  }
  const label =
    kind === "skip"
      ? ru
        ? "Пропущено"
        : "Skipped"
      : recurring
        ? ru
          ? "Выполнено за 2026-10-02, дальше 2026-10-03"
          : "Done for 2026-10-02, next 2026-10-03"
        : ru
          ? "Выполнено"
          : "Done";
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.setAttribute("role", "status");
  toast.innerHTML = `<div><strong>${label}</strong><p data-slot="description">${escaped(title)}</p></div><button data-action="undo">${ru ? "Отменить" : "Undo"}</button>`;
  const body = list.closest(".list-body");
  body.querySelector(".live-toasts").append(toast);
  toast.querySelector("button").addEventListener(
    "click",
    () => {
      if (!recurring)
        list.insertBefore(row, next?.parentElement === list ? next : null);
      else if (occurrence) {
        occurrence.textContent = oldDate;
        occurrence.dateTime = oldDate;
      }
      toast.remove();
      row.querySelector(".check").focus();
      updateEmpty(list);
    },
    { once: true },
  );
  updateEmpty(list);
  (list.querySelector(".check") || body.querySelector("input")).focus();
}
function updateEmpty(list) {
  let empty = list.parentElement.querySelector(".empty");
  if (!list.children.length && !empty) {
    empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "No open tasks.";
    list.before(empty);
  }
  if (list.children.length && empty) empty.remove();
}
document.addEventListener("click", (event) => {
  const navLink = event.target.closest(".sidebar.is-open a");
  if (navLink) closeNav(navLink.closest(".sidebar"));
  const trigger = event.target.closest("button");
  if (!trigger) {
    if (!event.target.closest(".menu")) closeMenus();
    return;
  }
  const action = trigger.dataset.action;
  const row = trigger.closest(".task-row");
  if (action === "menu") {
    const menu = row.querySelector(".menu");
    const opening = menu.hidden;
    closeMenus(menu);
    menu.hidden = !opening;
    trigger.setAttribute("aria-expanded", String(opening));
    if (opening) menu.querySelector("button:not(:disabled)").focus();
  } else if (action === "done" || action === "skip") {
    closeMenus();
    mark(row, action);
  } else if (action === "up" || action === "down") {
    const sibling =
      action === "up" ? row.previousElementSibling : row.nextElementSibling;
    if (sibling) action === "up" ? sibling.before(row) : sibling.after(row);
    closeMenus();
    row.querySelector('[data-action="menu"]').focus();
  } else if (action === "open" || action === "parent")
    openTask(row, trigger, action === "parent");
  else if (action === "close") drawer.close();
  else if (action === "nav") {
    const sidebar = trigger.closest(".shell").querySelector(".sidebar");
    const opening = !sidebar.classList.contains("is-open");
    sidebar.classList.toggle("is-open", opening);
    trigger.setAttribute("aria-expanded", String(opening));
    sidebar.closest(".shell").querySelector(".panel").inert = opening;
    if (opening) sidebar.querySelector("a").focus();
  } else if (action === "sync") {
    if (trigger.getAttribute("aria-busy") === "true") return;
    trigger.setAttribute("aria-busy", "true");
    trigger.insertAdjacentHTML(
      "afterbegin",
      '<span class="spinner" aria-hidden="true"></span>',
    );
    setTimeout(() => {
      trigger.setAttribute("aria-busy", "false");
      trigger.querySelector(".spinner")?.remove();
    }, 900);
  } else if (action === "reload") location.reload();
  else if (action === "undo") trigger.closest(".toast").remove();
});
document.addEventListener("keydown", (event) => {
  const openNav = event.target.closest(".sidebar.is-open");
  if (openNav && event.key === "Tab") {
    const controls = [...openNav.querySelectorAll("a, button:not(:disabled)")];
    const first = controls[0],
      last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
    return;
  }
  const menu = event.target.closest(".menu");
  if (
    menu &&
    ["ArrowDown", "ArrowUp", "Home", "End", "Escape", "Tab"].includes(event.key)
  ) {
    const items = [...menu.querySelectorAll("button:not(:disabled)")];
    if (event.key === "Escape" || event.key === "Tab") {
      const trigger = menu.parentElement.querySelector('[data-action="menu"]');
      closeMenus();
      if (event.key === "Escape") {
        event.preventDefault();
        trigger.focus();
      }
      return;
    }
    event.preventDefault();
    const i = items.indexOf(document.activeElement);
    const to =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? items.length - 1
          : (i + (event.key === "ArrowDown" ? 1 : -1) + items.length) %
            items.length;
    items[to].focus();
  } else if (event.key === "Escape") {
    const sidebar = document.querySelector(".sidebar.is-open");
    if (sidebar) closeNav(sidebar);
  }
});
drawer.addEventListener("close", () => {
  const url = new URL(location.href);
  url.searchParams.delete("task");
  history.replaceState(null, "", url);
  opener?.focus();
});
drawer.querySelector('[name="title"]').addEventListener("blur", (event) => {
  if (activeRow && event.target.value.trim())
    activeRow.querySelector(".task-title").textContent =
      event.target.value.trim();
});
drawer.querySelector('[name="notes"]').addEventListener("blur", (event) => {
  if (activeRow) activeRow.dataset.notes = event.target.value;
});
document.querySelectorAll(".quick").forEach((form) => {
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const input = form.querySelector("input");
    const text = input.value.trim();
    if (!text) return;
    const list = form.parentElement.querySelector(".task-list");
    let row =
      list.querySelector(".task-row")?.cloneNode(true) ||
      document.querySelector(".task-row").cloneNode(true);
    const id = "preview-" + Date.now();
    row.dataset.taskId = id;
    row.dataset.odId = id;
    row.querySelectorAll("[data-od-id]").forEach((node, index) => {
      node.dataset.odId = `${id}-control-${index}`;
    });
    row.dataset.recurring = "false";
    row.classList.remove("drop");
    const fields = text.split(/\s+/);
    const metadata = fields.filter(
      (part) => /^[@#]/.test(part) || /^p[0-4]$/.test(part),
    );
    const title = fields.filter((part) => !metadata.includes(part)).join(" ");
    if (!title) {
      const error = form.querySelector(".error-line");
      error.textContent = "That cannot be done. A title is required.";
      error.hidden = false;
      return;
    }
    row.querySelector(".task-title").textContent = title;
    row.querySelector(".metadata").innerHTML = metadata
      .filter((part) => part !== "p0")
      .map((part) =>
        /^p[1-4]$/.test(part)
          ? `<span class="badge ${part}">${part}</span>`
          : `<span>${escaped(part)}</span>`,
      )
      .join("");
    row.querySelector(".menu").hidden = true;
    row
      .querySelector('[data-action="menu"]')
      .setAttribute("aria-expanded", "false");
    list.append(row);
    input.value = "";
    form.querySelector(".error-line").hidden = true;
    updateEmpty(list);
  });
});
document.addEventListener("dragstart", (event) => {
  const row = event.target.closest(".task-row");
  if (!row) return;
  draggedRow = row;
  event.dataTransfer.setData("application/x-todoer-task", row.dataset.taskId);
  event.dataTransfer.effectAllowed = "move";
});
document.addEventListener("dragover", (event) => {
  const row = event.target.closest(".task-row");
  if (
    !draggedRow ||
    !row ||
    row === draggedRow ||
    row.parentElement !== draggedRow.parentElement
  )
    return;
  event.preventDefault();
  row.parentElement
    .querySelectorAll(".drop")
    .forEach((r) => r.classList.remove("drop"));
  row.classList.add("drop");
});
document.addEventListener("drop", (event) => {
  const row = event.target.closest(".task-row");
  if (
    !draggedRow ||
    !row ||
    row === draggedRow ||
    row.parentElement !== draggedRow.parentElement
  )
    return;
  event.preventDefault();
  row.before(draggedRow);
  row.classList.remove("drop");
  draggedRow.querySelector(".task-title").focus();
  draggedRow = null;
});
document.addEventListener("dragend", () => {
  document.querySelectorAll(".drop").forEach((r) => r.classList.remove("drop"));
  draggedRow = null;
});
const requested = new URL(location.href).searchParams.get("task");
if (requested) {
  const row = [...document.querySelectorAll(".task-row")].find(
    (r) => r.dataset.taskId === requested,
  );
  if (row) openTask(row, row.querySelector(".task-title"));
}
