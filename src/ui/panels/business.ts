// Negocios: the four production chains (Motos · Marihuana · Cocaína · Armas) drawn as HTML nodes with the UI
// illustrations and CSS/SVG arrows, a detail panel for the selected node, our businesses, the stock with the
// existing sale and cartel purchase controls, legal construction, the club's laundering and this week's orders.
// Stock is the faction's (global): it is never split among businesses.

import { h } from "../dom";
import { illustration } from "../assets";
import { msg, zoneName, type UiContext } from "../context";
import { CHAIN_IDS, chainView, type ChainNode, type ChainView } from "../productionChains";
import type { ManagementOrder } from "../../sim/management";
import { validateManagement } from "../../sim/management";
import { businessRows, buildableZones, cartelInfo, goodRows, launderingPanel } from "../viewModel";
import { EMPTY_FORM } from "../uiState";

const SVG_NS = "http://www.w3.org/2000/svg";

function arrow(kind: "flow" | "branch"): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", `chain-arrow ${kind}`);
  svg.setAttribute("viewBox", "0 0 24 12");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", "M0 6 H20 M15 1 L21 6 L15 11");
  svg.append(path);
  return svg;
}

function numberInput(value: number, onChange: (n: number) => void, label: string, max?: number): HTMLInputElement {
  return h("input", {
    type: "number",
    min: "0",
    max: max !== undefined ? String(max) : false,
    value: String(value),
    class: "num",
    "aria-label": label,
    onchange: (e: Event) => onChange(Math.max(0, Math.floor(Number((e.target as HTMLInputElement).value) || 0))),
  });
}

function nodeCard(ctx: UiContext, node: ChainNode): HTMLElement {
  const { data, ui, tr, set } = ctx;
  const name = node.kind === "sale" && node.sale ? tr(node.nameKey, { goodKey: tr(`good.${node.sale.goodId}`) }) : tr(node.nameKey, { goodKey: "" });
  const selected = ui.chainNode === node.key;
  return h(
    "button",
    {
      class: ["chain-node", node.kind, node.blocked ? "blocked" : "", selected ? "selected" : ""].join(" "),
      "aria-pressed": selected ? "true" : "false",
      onclick: () => set({ chainNode: selected ? null : node.key }),
    },
    [
      illustration(node.illustrationId, "medium", name, node.glyph),
      h("span", { class: "node-kind" }, [tr(`chain.kind.${node.kind}`)]),
      h("strong", { class: "node-name" }, [name]),
      h("span", { class: "node-status" }, [msg(data, node.status)]),
      node.blocked ? h("span", { class: "node-block" }, [h("span", { "aria-hidden": "true" }, ["▲ "]), tr("chain.blocked_short")]) : null,
    ],
  );
}

function chainDiagram(ctx: UiContext, view: ChainView): HTMLElement {
  const main = view.nodes.filter((n) => !view.edges.some((e) => e.kind === "branch" && e.to === n.key));
  const branches = view.edges.filter((e) => e.kind === "branch");
  const row: Node[] = [];
  main.forEach((node, i) => {
    if (i > 0) row.push(arrow("flow"));
    const branch = branches.find((b) => b.from === node.key);
    const branchNode = branch ? view.nodes.find((n) => n.key === branch.to) : undefined;
    row.push(
      branchNode
        ? h("div", { class: "chain-stack" }, [nodeCard(ctx, node), h("div", { class: "chain-branch" }, [arrow("branch"), nodeCard(ctx, branchNode)])])
        : nodeCard(ctx, node),
    );
  });
  return h("div", { class: "chain-scroll" }, [h("div", { class: "chain-row" }, row)]);
}

function goodDetail(ctx: UiContext, node: ChainNode): (Node | null)[] {
  const { state, data, tr } = ctx;
  const g = node.good!;
  const viewer = state.playerFactionId;
  const row = goodRows(state, data, viewer).find((r) => r.id === node.refId);
  const out: (Node | null)[] = [
    h("dl", { class: "facts" }, [
      h("dt", {}, [tr("chain.detail.stock")]),
      h("dd", { class: "mono" }, [String(g.stock), g.capacity !== null ? ` / ${g.capacity}` : ""]),
      h("dt", {}, [tr("chain.detail.in_transit")]),
      h("dd", { class: "mono" }, [String(g.inTransit)]),
      h("dt", {}, [tr("chain.detail.queued_buy")]),
      h("dd", { class: "mono" }, [String(g.queuedBuy)]),
      h("dt", {}, [tr("chain.detail.queued_sell")]),
      h("dd", { class: "mono" }, [String(g.queuedSell)]),
    ]),
  ];
  if (row) out.push(saleControls(ctx, row));
  return out;
}

/** The existing sale control for one good, or why it isn't sold from here. */
function saleControls(ctx: UiContext, g: ReturnType<typeof goodRows>[number]): HTMLElement {
  const { state, data, ui, tr, set } = ctx;
  const viewer = state.playerFactionId;
  if (g.id === data.balance.tasks.gunRun.goodId) return h("p", { class: "muted" }, [tr("ui.biz.guns_by_run")]);
  if (g.streetOnly) return h("p", { class: "muted" }, [tr("ui.biz.street_only")]);
  if (g.price === null) return h("p", { class: "muted" }, [tr("ui.biz.not_sold")]);
  const qty = Math.min(ui.sellAmounts[g.id] ?? g.stock, g.stock);
  const order: ManagementOrder = { kind: "sell", factionId: viewer, goodId: g.id, quantity: qty };
  const problem = qty > 0 ? validateManagement(state, data, order) : null;
  return h("div", { class: "row" }, [
    h("span", { class: "mono" }, [`$${g.price} ${tr(g.currencyKey ?? "")}`]),
    numberInput(qty, (n) => set({ sellAmounts: { ...ui.sellAmounts, [g.id]: n } }), tr("ui.biz.sell_amount", { good: tr(g.nameKey) }), g.stock),
    h("button", { disabled: qty <= 0 || problem !== null, onclick: () => set({ management: [...ui.management, order] }) }, [tr("ui.biz.sell")]),
    problem ? h("span", { class: "error" }, [tr(problem)]) : null,
  ]);
}

function businessDetail(ctx: UiContext, node: ChainNode): (Node | null)[] {
  const { data, tr, actions, set } = ctx;
  const b = node.business!;
  return [
    h("ul", { class: "plain rules" }, b.rules.map((r) => h("li", {}, [msg(data, r)]))),
    h("p", {}, [tr("chain.detail.cost", { cost: b.buildCost, upkeep: b.maintenance }), " · ", b.legal ? tr("ui.lot.legal") : tr("ui.lot.illegal_council")]),
    b.owned.length === 0
      ? h("p", { class: "muted" }, [b.legal ? tr("chain.detail.build_legal") : tr("chain.detail.build_illegal")])
      : h(
          "ul",
          { class: "plain" },
          b.owned.map((o) =>
            h("li", {}, [
              h("button", { class: "link", onclick: () => actions.enterZone(o.zoneId) }, [zoneName(data, o.zoneId)]),
              " · ",
              tr(`chain.status.${o.status}`),
            ]),
          ),
        ),
    b.queuedBuilds > 0 ? h("p", { class: "muted" }, [tr("chain.detail.queued_builds", { count: b.queuedBuilds })]) : null,
    b.legal
      ? null
      : h("button", { class: "link", onclick: () => { set({ form: { ...EMPTY_FORM, type: "open_illegal_business", businessTypeId: b.typeId } }); actions.navigate("council"); } }, [tr("chain.detail.to_council")]),
  ];
}

function taskDetail(ctx: UiContext, node: ChainNode): (Node | null)[] {
  const { state, data, tr, actions } = ctx;
  const t = node.task!;
  return [
    t.assigned.length === 0
      ? h("p", { class: "muted" }, [tr("chain.detail.nobody")])
      : h(
          "ul",
          { class: "plain" },
          t.assigned.map((a) => h("li", {}, [h("strong", {}, [state.members[a.memberId]?.nickname ?? a.memberId]), " · ", a.zoneId ? zoneName(data, a.zoneId) : tr("ui.pick_zone")])),
        ),
    h("p", { class: "muted" }, [tr("chain.detail.idle", { count: t.idle })]),
    h("button", { onclick: () => actions.navigate("club") }, [tr("chain.detail.to_club")]),
  ];
}

function cartelDetail(ctx: UiContext, node: ChainNode): (Node | null)[] {
  const { state, data, ui, tr, set, actions } = ctx;
  const c = node.cartel!;
  if (!c.dealing) {
    return [
      h("p", {}, [tr("ui.biz.no_deal")]),
      h("button", { onclick: () => { set({ form: { ...EMPTY_FORM, type: "cartel_deal" } }); actions.navigate("council"); } }, [tr("chain.detail.propose_deal")]),
    ];
  }
  const quantity = Math.max(1, ui.buyQuantities[c.goodId] ?? 1);
  const order: ManagementOrder = { kind: "buy", factionId: state.playerFactionId, goodId: c.goodId, quantity };
  const problem = validateManagement(state, data, order);
  return [
    h("p", {}, [tr("ui.biz.deal_info", { weeks: c.weeksLeft ?? 0 })]),
    (c.weeksLeft ?? 1) <= 0 ? h("p", { class: "warn-text" }, [h("span", { "aria-hidden": "true" }, ["▲ "]), tr("chain.detail.buy_now")]) : null,
    h("dl", { class: "facts" }, [
      h("dt", {}, [tr("chain.detail.price")]),
      h("dd", { class: "mono" }, [tr("chain.detail.price_dirty", { price: c.price })]),
      h("dt", {}, [tr("chain.detail.space")]),
      h("dd", { class: "mono" }, [c.space === null ? "—" : String(c.space)]),
      h("dt", {}, [tr("chain.detail.dirty")]),
      h("dd", { class: "mono" }, [`$${c.dirty}`]),
    ]),
    h("div", { class: "row" }, [
      numberInput(quantity, (n) => set({ buyQuantities: { ...ui.buyQuantities, [c.goodId]: Math.max(1, n) } }), tr("ui.biz.buy_amount", { good: tr(`good.${c.goodId}`) }), Math.max(1, c.space ?? 1)),
      h("button", { disabled: problem !== null, onclick: () => set({ management: [...ui.management, order] }) }, [tr("ui.biz.buy")]),
    ]),
    problem ? h("p", { class: "error" }, [tr(problem)]) : null,
  ];
}

function saleDetail(ctx: UiContext, node: ChainNode): (Node | null)[] {
  const { tr, actions } = ctx;
  const s = node.sale!;
  return [
    h("p", {}, [s.price === null ? tr("ui.biz.not_sold") : tr("chain.sale.price", { price: s.price, currencyKey: s.currencyKey ? tr(s.currencyKey) : "" })]),
    s.how === "task" && s.taskId
      ? h("div", {}, [h("p", { class: "muted" }, [tr("chain.detail.sold_by_task", { taskKey: tr(`task.${s.taskId}`) })]), h("button", { onclick: () => actions.navigate("club") }, [tr("chain.detail.to_club")])])
      : h("p", { class: "muted" }, [tr("chain.detail.sold_from_stock")]),
  ];
}

function nodeDetail(ctx: UiContext, view: ChainView): HTMLElement {
  const { data, ui, tr } = ctx;
  const node = view.nodes.find((n) => n.key === ui.chainNode) ?? view.nodes.find((n) => n.blocked) ?? view.nodes[0]!;
  const name = node.kind === "sale" && node.sale ? tr(node.nameKey, { goodKey: tr(`good.${node.sale.goodId}`) }) : tr(node.nameKey, { goodKey: "" });
  const body =
    node.kind === "good" ? goodDetail(ctx, node) : node.kind === "business" ? businessDetail(ctx, node) : node.kind === "task" ? taskDetail(ctx, node) : node.kind === "cartel" ? cartelDetail(ctx, node) : saleDetail(ctx, node);
  return h("aside", { class: "chain-detail", "aria-live": "polite" }, [
    h("div", { class: "detail-head" }, [
      illustration(node.illustrationId, "large", name, node.glyph),
      h("div", {}, [h("span", { class: "node-kind" }, [tr(`chain.kind.${node.kind}`)]), h("h2", {}, [name]), h("p", {}, [msg(data, node.status)])]),
    ]),
    node.blocked ? h("p", { class: "block-msg" }, [h("strong", {}, [tr("chain.blocked_short"), ": "]), msg(data, node.blocked)]) : null,
    ...body.filter((n): n is Node => n !== null),
  ]);
}

function businessTable(ctx: UiContext): HTMLElement {
  const { state, data, tr, actions } = ctx;
  const rows = businessRows(state, data, state.playerFactionId);
  if (rows.length === 0) return h("p", { class: "muted" }, [tr("ui.biz.none_long")]);
  return h("div", { class: "table-scroll" }, [
    h("table", { class: "data" }, [
      h("thead", {}, [h("tr", {}, ["ui.biz.col.business", "ui.biz.col.zone", "ui.biz.col.legal", "ui.biz.col.status", "ui.biz.col.upkeep"].map((k) => h("th", { scope: "col" }, [tr(k)])))]),
      h(
        "tbody",
        {},
        rows.map((b) =>
          h("tr", {}, [
            h("td", { class: "with-icon" }, [illustration(b.typeId, "small", tr(b.typeKey), "?"), tr(b.typeKey)]),
            h("td", {}, [h("button", { class: "link", title: tr("ui.biz.to_map"), onclick: () => actions.enterZone(b.zoneId) }, [b.zone]), h("span", { class: "muted" }, [` · ${tr("ui.lot.title", { index: b.lot + 1 })}`])]),
            h("td", {}, [b.legal ? tr("ui.biz.legal") : tr("ui.biz.illegal_short")]),
            h("td", { class: b.statusKey === "ui.biz.suspended" ? "warn" : "" }, [tr(b.statusKey)]),
            h("td", { class: "mono" }, [`$${b.maintenance}`]),
          ]),
        ),
      ),
    ]),
  ]);
}

function stockTable(ctx: UiContext): HTMLElement {
  const { state, data, tr } = ctx;
  return h("div", { class: "table-scroll" }, [
    h("table", { class: "data" }, [
      h("thead", {}, [h("tr", {}, ["ui.biz.col.good", "ui.biz.col.stock", "ui.biz.col.sale"].map((k) => h("th", { scope: "col" }, [tr(k)])))]),
      h(
        "tbody",
        {},
        goodRows(state, data, state.playerFactionId).map((g) =>
          h("tr", {}, [h("td", { class: "with-icon" }, [illustration(g.id, "small", tr(g.nameKey), "?"), tr(g.nameKey)]), h("td", { class: "mono" }, [String(g.stock)]), h("td", {}, [saleControls(ctx, g)])]),
        ),
      ),
    ]),
  ]);
}

function buildForm(ctx: UiContext): HTMLElement {
  const { state, data, ui, tr, set } = ctx;
  const viewer = state.playerFactionId;
  const zones = buildableZones(state, data, viewer);
  const typeSel = h("select", { "aria-label": tr("ui.biz.pick_type"), id: "build-type" }, [
    h("option", { value: "" }, [tr("ui.biz.pick_type")]),
    ...data.businesses.filter((b) => b.legal).map((b) => h("option", { value: b.id }, [`${tr(`business.${b.id}`)} ($${b.buildCost}, ${tr("ui.biz.upkeep", { cost: b.maintenance })})`])),
  ]);
  const zoneSel = h("select", { "aria-label": tr("ui.biz.pick_zone"), id: "build-zone" }, [
    h("option", { value: "" }, [zones.length === 0 ? tr("ui.biz.no_zone") : tr("ui.biz.pick_zone")]),
    ...zones.map((z) => h("option", { value: z }, [zoneName(data, z)])),
  ]);
  const problemEl = h("div", { class: "error" });
  const button = h("button", { disabled: true }, [tr("ui.biz.add_build")]);
  const order = (): ManagementOrder | null => (typeSel.value && zoneSel.value ? { kind: "build", factionId: viewer, typeId: typeSel.value, zoneId: zoneSel.value } : null);
  const refresh = () => {
    const o = order();
    const problem = o ? validateManagement(state, data, o) : null;
    problemEl.textContent = problem ? tr(problem) : "";
    button.disabled = !o || problem !== null;
  };
  typeSel.addEventListener("change", refresh);
  zoneSel.addEventListener("change", refresh);
  button.addEventListener("click", () => {
    const o = order();
    if (o) set({ management: [...ui.management, o] });
  });
  return h("div", { class: "form" }, [typeSel, zoneSel, problemEl, button, h("p", { class: "muted" }, [tr("ui.biz.build_hint")])]);
}

function launderPanel(ctx: UiContext): HTMLElement {
  const { state, data, ui, tr, set } = ctx;
  const viewer = state.playerFactionId;
  const l = launderingPanel(state, data, viewer, ui.management);
  const sources = h(
    "table",
    { class: "data compact" },
    [
      h("tbody", {}, [
        ...l.sources.map((s) => h("tr", {}, [h("td", {}, [tr(s.typeKey), h("span", { class: "muted" }, [` · ${s.zone}`])]), h("td", { class: "muted" }, [tr(s.statusKey)]), h("td", { class: "mono num-cell" }, [`$${s.capacity}`])])),
        h("tr", { class: "total" }, [h("td", {}, [tr("ui.launder.total")]), h("td", {}, []), h("td", { class: "mono num-cell" }, [`$${l.capacity}`])]),
      ]),
    ],
  );
  if (l.capacity === 0) {
    return h("section", { class: "panel-card" }, [
      h("h3", {}, [tr("ui.launder.title")]),
      l.sources.length > 0 ? sources : null,
      h("p", { class: "muted" }, [tr("ui.biz.no_laundering")]),
    ]);
  }
  const max = Math.min(l.capacity, Math.max(0, Math.floor(l.dirty)));
  const amount = Math.min(ui.launderAmount, max);
  const over = amount > l.safe;
  const range = h("input", { type: "range", min: "0", max: String(max), step: "10", value: String(amount), "aria-label": tr("ui.launder.amount") });
  const num = h("input", { type: "number", min: "0", max: String(max), value: String(amount), class: "num", "aria-label": tr("ui.launder.amount") });
  const sync = (value: number) => set({ launderAmount: Math.max(0, Math.min(max, Math.floor(value) || 0)) });
  range.addEventListener("change", () => sync(Number(range.value)));
  range.addEventListener("input", () => (num.value = range.value));
  num.addEventListener("change", () => sync(Number(num.value)));
  return h("section", { class: "panel-card" }, [
    h("h3", {}, [tr("ui.launder.title")]),
    sources,
    h("div", { class: "launder-control" }, [range, num, h("span", { class: "mono" }, [`/ $${l.capacity}`])]),
    h("div", { class: "meter wide" }, [h("span", { class: over ? "meter-fill over" : "meter-fill", style: `width:${Math.round((100 * amount) / l.capacity)}%` }), h("span", { class: "meter-mark", style: `left:${l.safePercent}%` })]),
    h("p", { class: "muted" }, [tr("ui.launder.safe", { percent: l.safePercent, safe: l.safe }), " · ", tr("ui.launder.dirty", { dirty: l.dirty })]),
    l.queued > 0 ? h("p", { class: "muted" }, [tr("ui.launder.queued", { amount: l.queued })]) : null,
    over ? h("p", { class: "warn-box", role: "alert" }, [h("span", { "aria-hidden": "true" }, ["▲ "]), tr("ui.biz.launder_warning", { percent: l.safePercent })]) : null,
    h("button", { disabled: amount <= 0, onclick: () => set({ management: [...ui.management, { kind: "launder", factionId: viewer, amount }], launderAmount: 0 }) }, [tr("ui.biz.add_launder")]),
  ]);
}

export function managementLabel(ctx: UiContext, o: ManagementOrder): string {
  const { data, tr } = ctx;
  switch (o.kind) {
    case "build":
      return `${tr("management.build")}: ${tr(`business.${o.typeId}`)} (${zoneName(data, o.zoneId)}${o.lot !== undefined ? ` · ${tr("ui.lot.title", { index: o.lot + 1 })}` : ""})`;
    case "sell":
      return `${tr("management.sell")}: ${o.quantity} × ${tr(`good.${o.goodId}`)}`;
    case "launder":
      return `${tr("management.launder")}: $${o.amount}`;
    case "buy":
      return `${tr("management.buy")}: ${o.quantity} × ${tr(`good.${o.goodId}`)}`;
  }
}

function pendingOrders(ctx: UiContext): HTMLElement {
  const { state, data, ui, tr, set } = ctx;
  return h("section", { class: "panel-card" }, [
    h("h3", {}, [tr("ui.biz.pending")]),
    ui.management.length === 0
      ? h("p", { class: "muted" }, [tr("ui.council.none")])
      : h(
          "ul",
          { class: "plain" },
          ui.management.map((o, i) => {
            const problem = validateManagement(state, data, o);
            return h("li", { class: "row" }, [
              managementLabel(ctx, o),
              problem ? h("span", { class: "error" }, [tr(problem)]) : null,
              h("button", { class: "chip", onclick: () => set({ management: ui.management.filter((_, j) => j !== i) }) }, [tr("ui.council.remove")]),
            ]);
          }),
        ),
  ]);
}

export function renderBusiness(ctx: UiContext): HTMLElement {
  const { state, data, ui, tr, set } = ctx;
  const view = chainView(state, data, state.playerFactionId, ui.chain, { draft: ui.draft, management: ui.management });
  const cartel = cartelInfo(state, data, state.playerFactionId);
  return h("div", { class: "business-view" }, [
    h("section", { class: "chains" }, [
      h("div", { class: "chain-head" }, [
        h("h3", {}, [tr("ui.biz.chains")]),
        h(
          "div",
          { class: "segmented", role: "tablist", "aria-label": tr("ui.biz.chains") },
          CHAIN_IDS.map((id) =>
            h("button", { role: "tab", "aria-selected": ui.chain === id ? "true" : "false", class: ui.chain === id ? "active" : "", onclick: () => set({ chain: id, chainNode: null }) }, [tr(`chain.${id}`)]),
          ),
        ),
      ]),
      h("div", { class: "chain-layout" }, [
        h("div", {}, [chainDiagram(ctx, view), h("ul", { class: "plain notes" }, view.notes.map((n) => h("li", { class: "muted" }, [msg(data, n)])))]),
        nodeDetail(ctx, view),
      ]),
    ]),
    h("div", { class: "business-grid" }, [
      h("section", { class: "panel-card span-2" }, [h("h3", {}, [tr("ui.biz.ours")]), businessTable(ctx)]),
      launderPanel(ctx),
      h("section", { class: "panel-card span-2" }, [h("h3", {}, [tr("ui.biz.stock")]), stockTable(ctx)]),
      h("section", { class: "panel-card" }, [
        h("h3", {}, [tr("ui.biz.cartel")]),
        cartel.dealing
          ? h("div", {}, [
              h("p", { class: "muted" }, [tr("ui.biz.deal_info", { weeks: cartel.weeksLeft ?? 0 })]),
              ...cartel.catalog.map((item) => h("p", {}, [`${tr(item.nameKey)} · $${item.price} · ${tr("ui.biz.space", { space: item.space })}`])),
              h("p", { class: "muted" }, [tr("ui.biz.buy_in_chain")]),
            ])
          : h("div", {}, [h("p", { class: "muted" }, [tr("ui.biz.no_deal")])]),
        h("h3", {}, [tr("ui.biz.build")]),
        buildForm(ctx),
      ]),
      pendingOrders(ctx),
    ]),
  ]);
}
